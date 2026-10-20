import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getAnthropicClient } from '@/lib/anthropic';
import { prisma } from '@/lib/prisma';
import { artifactWorkspaceDir } from '@/lib/project-files';
import { searchKnowledge } from '@/lib/project-reviews/retrieval';

import {
  deriveFeatureStatus,
  detectFeatureCandidates,
  validateSummaries,
  type FeatureCandidate,
} from './features';
import { buildInventory, isScannableText, stripArtifactSlug, type EvidenceItem, type SourceFile } from './inventory';

const MODEL = process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';
const MAX_FILES_READ = 400;
const MAX_FILE_BYTES = 150_000;
const MAX_TOTAL_BYTES = 4_000_000;

/** Lists ProjectFile rows and reads text content from the project workspace. Never reads secrets/env files. */
export async function loadSourceFiles(projectId: string) {
  const rows = await prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { path: 'asc' },
    select: { path: true, sizeBytes: true, updatedAt: true },
  });

  const files: SourceFile[] = [];
  let total = 0;
  let read = 0;
  let newestChange: Date | null = null;
  for (const row of rows) {
    if (!newestChange || row.updatedAt > newestChange) newestChange = row.updatedAt;
    const relative = stripArtifactSlug(row.path);
    const slug = row.path.split('/')[0];
    const sensitive = /(^|\/)\.env|secret|\.pem$|\.key$/i.test(relative);
    if (
      sensitive ||
      !isScannableText(relative) ||
      row.sizeBytes > MAX_FILE_BYTES ||
      read >= MAX_FILES_READ ||
      total + row.sizeBytes > MAX_TOTAL_BYTES ||
      /(^|\/)node_modules\//.test(relative)
    ) {
      files.push({ path: row.path });
      continue;
    }
    try {
      const root = path.resolve(artifactWorkspaceDir(projectId, slug));
      const absolute = path.resolve(root, relative);
      if (!absolute.startsWith(root + path.sep)) throw new Error('escape');
      const content = await readFile(absolute, 'utf8');
      total += row.sizeBytes;
      read += 1;
      files.push({ path: row.path, content });
    } catch {
      files.push({ path: row.path });
    }
  }
  return { files, newestChange };
}

async function summarise(candidates: FeatureCandidate[]): Promise<Map<string, string>> {
  const present = candidates.filter((c) => c.present);
  if (!present.length) return new Map();
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 900,
      system:
        'You write one-sentence neutral summaries of app features for an internal ledger. Use ONLY the supplied evidence. Never invent behaviour. Each summary MUST list the evidence "ref" values it relies on, copied exactly. Respond with ONLY JSON: {"features":[{"key":string,"summary":string,"refs":string[]}]}',
      messages: [
        {
          role: 'user',
          content: JSON.stringify(
            present.map((c) => ({ key: c.key, name: c.name, evidence: c.evidence.slice(0, 5) })),
          ),
        },
      ],
    });
    const block = response.content.find((c) => c.type === 'text');
    return block && block.type === 'text' ? validateSummaries(present, block.text) : new Map();
  } catch (error) {
    console.error('Feature summarisation failed:', error);
    return new Map();
  }
}

/** Rebuilds the feature ledger from real evidence. Idempotent. */
export async function refreshFeatureLedger(projectId: string, options: { summarise?: boolean } = {}) {
  const [{ files, newestChange }, deployment, smoke, knowledge, issues] = await Promise.all([
    loadSourceFiles(projectId),
    prisma.deployment.findFirst({
      where: { projectId, isCurrent: true, status: 'LIVE' },
      select: { version: true, publishedAt: true },
    }),
    prisma.smokeCheck.findFirst({
      where: { projectId },
      orderBy: { checkedAt: 'desc' },
      select: { id: true, outcome: true, version: true, checkedAt: true },
    }),
    prisma.projectKnowledge.findMany({ where: { projectId }, select: { id: true, title: true, content: true } }),
    prisma.projectIssue.findMany({
      where: { projectId, status: { in: ['OPEN', 'ANALYSING', 'FIX_PROPOSED', 'APPROVED'] } },
      select: { id: true, title: true, analysis: true },
    }),
  ]);

  const candidates = detectFeatureCandidates(files);
  const summaries = options.summarise === false ? new Map<string, string>() : await summarise(candidates);
  const deployedCurrent = Boolean(
    deployment && (!newestChange || !deployment.publishedAt || deployment.publishedAt >= newestChange),
  );
  const smokePassed = Boolean(
    deployment && smoke?.outcome === 'PASS' && (smoke.version ?? deployment.version) === deployment.version,
  );
  const issueDocs = issues.map((i) => ({ id: i.id, title: i.title, content: i.analysis ?? '' }));

  for (const candidate of candidates) {
    const evidence: EvidenceItem[] = [...candidate.evidence];
    if (candidate.present && deployment) {
      evidence.push({
        type: 'deployment',
        ref: `deployment:v${deployment.version}`,
        detail: deployedCurrent
          ? `Included in live deployment v${deployment.version}`
          : `Live deployment v${deployment.version} predates the latest file changes`,
      });
    }
    if (candidate.present && smoke) {
      evidence.push({ type: 'smoke', ref: `smoke:${smoke.id}`, detail: `Latest smoke check: ${smoke.outcome}` });
    }
    for (const doc of searchKnowledge(candidate.name, knowledge, 2)) {
      evidence.push({ type: 'knowledge', ref: `knowledge:${doc.id}`, detail: `Owner knowledge entry "${doc.title}"` });
    }
    const matchingIssues = candidate.present ? searchKnowledge(candidate.name, issueDocs, 2) : [];
    for (const issue of matchingIssues) {
      evidence.push({ type: 'issue', ref: `issue:${issue.id}`, detail: `Open issue "${issue.title}"` });
    }

    const status = deriveFeatureStatus({
      evidence,
      deployedCurrent,
      smokePassedForDeployment: smokePassed,
      hasOpenIssue: matchingIssues.length > 0,
    });
    const data = {
      name: candidate.name,
      ...(options.summarise === false ? {} : { summary: summaries.get(candidate.key) ?? null }),
      status,
      evidence: JSON.parse(JSON.stringify(evidence)),
      version: deployment?.version ?? null,
      verifiedAt: status === 'TESTED' && smoke ? smoke.checkedAt : null,
    };
    await prisma.appFeature.upsert({
      where: { projectId_key: { projectId, key: candidate.key } },
      create: { projectId, key: candidate.key, ...data },
      update: data,
    });
  }

  await prisma.appFeature.deleteMany({
    where: { projectId, key: { notIn: candidates.map((c) => c.key) } },
  });

  return { features: candidates.length, inventory: buildInventory(files) };
}

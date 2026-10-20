import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { evaluateApprovalGate, formatApprovalGateError } from '@/lib/code-scan/approvals';
import { checkCodeScan } from '@/lib/code-scan/readiness';
import { getLatestRegression } from '@/lib/code-scan/regression';
import { evaluateScanGate, runCodeScan } from '@/lib/code-scan/service';
import { formatScanGateError } from '@/lib/code-scan/scan';
import { extractPageSignals, guardedFetch, resolveSmokeTarget } from '@/lib/observatory/smoke';
import { prisma } from '@/lib/prisma';
import {
  PUBLISH_META_FILE,
  publishedSnapshotDir,
  type SnapshotEnvironment,
} from '@/lib/publish/snapshot';
import { listProjectFiles, readProjectFile } from '@/lib/project-files';

import {
  CHECK_TITLES,
  evaluateReadiness,
  runStaticChecks,
  summarize,
  type CheckResult,
  type LiveProbe,
  type SiteFile,
  type SmokeSummary,
} from './checks';

const MAX_FILES = 400;
const MAX_FILE_BYTES = 2_000_000;
const TEXT_FILE = /\.(html?|css|js|mjs|cjs|json|txt|xml|svg|md)$/i;

export type SiteSource = 'STAGING' | 'PRODUCTION' | 'WORKING';

async function readSnapshotDir(root: string, dir = root, out: SiteFile[] = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name === 'node_modules' || entry.name === PUBLISH_META_FILE) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await readSnapshotDir(root, full, out);
    } else if (TEXT_FILE.test(entry.name)) {
      const info = await stat(full).catch(() => null);
      if (!info || info.size > MAX_FILE_BYTES) continue;
      out.push({
        path: path.relative(root, full).split(path.sep).join('/'),
        content: await readFile(full, 'utf8'),
      });
    }
  }
  return out;
}

/** The files a launch would serve: the frozen snapshot, or the working files when nothing is published yet. */
export async function loadSiteFiles(
  projectId: string,
  preferred: SiteSource,
): Promise<{ files: SiteFile[]; source: SiteSource; artifactSlug: string | null }> {
  const artifacts = await prisma.artifact.findMany({
    where: { projectId },
    orderBy: { sortOrder: 'asc' },
    select: { slug: true },
  });
  const slug = artifacts[0]?.slug ?? null;
  if (!slug) return { files: [], source: 'WORKING', artifactSlug: null };

  const order: SiteSource[] =
    preferred === 'STAGING'
      ? ['STAGING', 'PRODUCTION', 'WORKING']
      : preferred === 'PRODUCTION'
        ? ['PRODUCTION', 'WORKING']
        : ['WORKING'];

  for (const source of order) {
    if (source === 'WORKING') break;
    const files = await readSnapshotDir(
      publishedSnapshotDir(projectId, slug, source as SnapshotEnvironment),
    );
    if (files.length > 0) return { files, source, artifactSlug: slug };
  }

  const prefix = `${slug}/`;
  const listed = (await listProjectFiles(projectId, slug)).filter((f) => TEXT_FILE.test(f.path));
  const files: SiteFile[] = [];
  for (const file of listed.slice(0, MAX_FILES)) {
    const relative = file.path.slice(prefix.length);
    const content = await readProjectFile(projectId, slug, relative).catch(() => null);
    if (typeof content === 'string') files.push({ path: relative, content });
  }
  return { files, source: 'WORKING', artifactSlug: slug };
}

async function probeLive(projectId: string): Promise<{
  live: LiveProbe | null;
  version: number | null;
}> {
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
    select: { version: true, domain: true, customDomain: true },
  });
  if (!deployment) return { live: null, version: null };
  const target = resolveSmokeTarget(deployment);
  if (!target) return { live: null, version: deployment.version };

  try {
    const page = await guardedFetch(target.url, target.allowedHosts);
    const signals = extractPageSignals(page.body, page.finalUrl);
    const broken: string[] = [];
    for (const link of signals.links) {
      try {
        const res = await guardedFetch(link, target.allowedHosts);
        if (res.status >= 400) broken.push(`${link} → ${res.status}`);
      } catch (error) {
        broken.push(`${link} → ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    return {
      live: {
        url: page.finalUrl,
        status: page.status,
        headers: page.headers ?? {},
        brokenLinks: broken,
        linksChecked: signals.links.length,
      },
      version: deployment.version,
    };
  } catch (error) {
    return {
      live: { url: target.url, error: error instanceof Error ? error.message : 'request failed' },
      version: deployment.version,
    };
  }
}

async function latestSmoke(projectId: string): Promise<SmokeSummary | null> {
  const row = await prisma.smokeCheck.findFirst({
    where: { projectId },
    orderBy: { checkedAt: 'desc' },
    select: { outcome: true, checkedAt: true, version: true },
  });
  if (!row) return null;
  return {
    outcome: row.outcome as SmokeSummary['outcome'],
    checkedAt: row.checkedAt.toISOString(),
    version: row.version,
  };
}

export type StoredReport = {
  id: string;
  environment: 'STAGING' | 'PRODUCTION';
  results: CheckResult[];
  failCount: number;
  warnCount: number;
  createdAt: string;
  approvedAt: string | null;
  acknowledgedWarnings: boolean;
  verdict: string;
  source: SiteSource;
};

export function toStoredReport(
  row: {
    id: string;
    environment: 'STAGING' | 'PRODUCTION';
    results: unknown;
    failCount: number;
    warnCount: number;
    createdAt: Date;
    approvedAt: Date | null;
    acknowledgedWarnings: boolean;
  },
  source: SiteSource = 'WORKING',
): StoredReport {
  const results = (Array.isArray(row.results) ? row.results : []) as CheckResult[];
  return {
    id: row.id,
    environment: row.environment,
    results,
    failCount: row.failCount,
    warnCount: row.warnCount,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    acknowledgedWarnings: row.acknowledgedWarnings,
    verdict: summarize(results).verdict,
    source,
  };
}

/** Runs every check, stores the report and returns it. */
export async function runLaunchReadiness(
  projectId: string,
  environment: 'STAGING' | 'PRODUCTION' = 'PRODUCTION',
) {
  const [site, project, probe, smoke] = await Promise.all([
    loadSiteFiles(projectId, environment),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { seoTitle: true, seoDescription: true, seoImageUrl: true },
    }),
    probeLive(projectId),
    latestSmoke(projectId),
  ]);

  const results = evaluateReadiness({
    files: site.files,
    seo: {
      title: project?.seoTitle,
      description: project?.seoDescription,
      imageUrl: project?.seoImageUrl,
    },
    live: probe.live,
    smoke,
    liveVersion: probe.version,
  });
  results.push(await codeScanCheck(projectId, environment));
  results.push(await regressionCheck(projectId));
  const summary = summarize(results);

  const row = await prisma.launchReport.create({
    data: {
      projectId,
      environment,
      results: JSON.parse(JSON.stringify(results)),
      failCount: summary.failCount,
      warnCount: summary.warnCount,
      deploymentVersion: probe.version,
    },
  });
  return toStoredReport(row, site.source);
}

export type PublishGate = {
  blocked: boolean;
  failures: CheckResult[];
  warnings: CheckResult[];
};

/**
 * Fast file-only check used by the publish flow: FAIL blocks, WARN is surfaced.
 * Live checks are skipped because the site is not yet at its new version.
 */
export async function evaluatePublishGate(
  projectId: string,
  source: SiteSource,
): Promise<PublishGate> {
  const [site, project] = await Promise.all([
    loadSiteFiles(projectId, source),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { seoTitle: true, seoDescription: true, seoImageUrl: true },
    }),
  ]);
  const results = runStaticChecks(site.files, {
    title: project?.seoTitle,
    description: project?.seoDescription,
    imageUrl: project?.seoImageUrl,
  });
  const failures = results.filter((r) => r.status === 'FAIL');
  const warnings = results.filter((r) => r.status === 'WARN');
  try {
    const scan = await evaluateScanGate(projectId, source);
    if (scan.blocked) {
      failures.push({
        id: 'code_scan',
        title: CHECK_TITLES.code_scan,
        status: 'FAIL',
        evidence: formatScanGateError(scan.blocking),
        advice: 'Fix the findings or acknowledge them with a reason in the Security scan panel.',
      });
    } else if (scan.depStatus === 'UNAVAILABLE') {
      warnings.push({
        id: 'code_scan',
        title: CHECK_TITLES.code_scan,
        status: 'WARN',
        evidence: scan.depDetail ?? 'Dependencies could not be checked.',
      });
    }
  } catch {
    failures.push({
      id: 'code_scan',
      title: CHECK_TITLES.code_scan,
      status: 'FAIL',
      evidence: 'The security scan could not be completed, so the project was not checked. Please try again.',
    });
  }
  try {
    const approval = await evaluateApprovalGate(projectId);
    if (approval.required && approval.state !== 'APPROVED') {
      failures.push({
        id: 'change_approval',
        title: CHECK_TITLES.change_approval,
        status: 'FAIL',
        evidence: formatApprovalGateError(approval),
        advice: 'Request approval in the Quality & Security page; the project owner decides.',
      });
    }
  } catch {
    failures.push({
      id: 'change_approval',
      title: CHECK_TITLES.change_approval,
      status: 'FAIL',
      evidence: 'Approval status could not be checked, so the publish was stopped. Please try again.',
    });
  }
  return {
    blocked: failures.length > 0,
    failures,
    warnings,
  };
}

async function regressionCheck(projectId: string): Promise<CheckResult> {
  const base = { id: 'regression' as const, title: CHECK_TITLES.regression };
  try {
    const latest = await getLatestRegression(projectId);
    if (!latest || latest.status === 'NOT_RUN') {
      return { ...base, status: 'NOT_VERIFIED', evidence: 'No regression check has run. Tests/build were not verified.' };
    }
    if (latest.status === 'FAILED') {
      return { ...base, status: 'WARN', evidence: 'The latest regression check failed. Publishing needs owner approval.' };
    }
    return { ...base, status: 'PASS', evidence: 'The latest regression check passed.' };
  } catch {
    return { ...base, status: 'NOT_VERIFIED', evidence: 'The regression result could not be read.' };
  }
}

async function codeScanCheck(projectId: string, environment: SnapshotEnvironment): Promise<CheckResult> {
  try {
    return checkCodeScan(await runCodeScan({ projectId, trigger: 'READINESS', source: environment }));
  } catch {
    return {
      id: 'code_scan',
      title: CHECK_TITLES.code_scan,
      status: 'NOT_VERIFIED',
      evidence: 'The security scan could not be completed.',
    };
  }
}

export function formatGateError(gate: PublishGate) {
  return `Launch readiness found ${gate.failures.length} blocking issue(s): ${gate.failures
    .map((f) => f.evidence)
    .join(' ')} Fix them, then publish again.`;
}

'use server';

import { revalidatePath } from 'next/cache';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { getCachedSession } from '@/lib/auth/cached';
import {
  canApproveLaunch,
  detectAnalytics,
  detectPaymentProviders,
  type CheckResult,
} from '@/lib/launch-readiness/checks';
import {
  generateLegalDraft,
  LEGAL_FILES,
  type LegalKind,
} from '@/lib/launch-readiness/legal-drafts';
import {
  loadSiteFiles,
  runLaunchReadiness,
  toStoredReport,
  type StoredReport,
} from '@/lib/launch-readiness/service';
import { prisma } from '@/lib/prisma';
import { getAccessibleProject } from '@/lib/projects/access';
import { listProjectFiles, writeProjectFile } from '@/lib/project-files';
import { rateLimit } from '@/lib/rate-limit';

type Env = 'STAGING' | 'PRODUCTION';
type ReportResult = { report: StoredReport } | { error: string };

async function authorize(projectId: string) {
  const fail = (error: string): { error: string } => ({ error });
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return fail('You must be signed in.');
  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    name: true,
    description: true,
    slug: true,
    workspace: { select: { slug: true } },
  });
  if (!project) return fail('Project not found.');
  const ok: { userId: string; project: typeof project } = { userId, project };
  return ok;
}

const isEnv = (value: string): value is Env => value === 'STAGING' || value === 'PRODUCTION';

export async function getLatestLaunchReportAction(
  projectId: string,
  environment: Env = 'PRODUCTION',
): Promise<{ report: StoredReport | null } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  if (!isEnv(environment)) return { error: 'Invalid environment.' };
  const row = await prisma.launchReport.findFirst({
    where: { projectId, environment },
    orderBy: { createdAt: 'desc' },
  });
  return { report: row ? toStoredReport(row) : null };
}

export async function runLaunchReadinessAction(
  projectId: string,
  environment: Env = 'PRODUCTION',
): Promise<ReportResult> {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  if (!isEnv(environment)) return { error: 'Invalid environment.' };

  const limit = await rateLimit(`launch-readiness:${auth.userId}`, 20, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Too many checks. Try again in ${limit.retryAfter}s.` };

  return { report: await runLaunchReadiness(projectId, environment) };
}

/** Owner decision. FAIL always blocks; warnings need `acknowledgeWarnings`. */
export async function approveLaunchAction(
  projectId: string,
  reportId: string,
  acknowledgeWarnings: boolean,
): Promise<{ success: true } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;

  const report = await prisma.launchReport.findFirst({ where: { id: reportId, projectId } });
  if (!report) return { error: 'Report not found.' };

  const latest = await prisma.launchReport.findFirst({
    where: { projectId, environment: report.environment },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (latest?.id !== report.id) {
    return { error: 'A newer report exists. Run the checks again before approving.' };
  }

  const results = (Array.isArray(report.results) ? report.results : []) as CheckResult[];
  const decision = canApproveLaunch(results, acknowledgeWarnings === true);
  if (!decision.ok) return { error: decision.error };

  await prisma.launchReport.update({
    where: { id: report.id },
    data: {
      approvedAt: new Date(),
      approvedById: auth.userId,
      acknowledgedWarnings: report.warnCount > 0 && acknowledgeWarnings === true,
    },
  });

  await recordUserActivity({
    userId: auth.userId,
    action: 'project.launch_approved',
    targetType: 'Project',
    targetId: projectId,
    after: {
      reportId,
      warningsAcknowledged: report.warnCount > 0,
      warnCount: report.warnCount,
    },
  });
  revalidatePath(`/app/projects/${auth.project.workspace.slug}/${auth.project.slug}/launch`);
  return { success: true };
}

/**
 * Writes an AI-drafted privacy/terms page into the project's files so the
 * owner can edit it. Never overwrites an existing file.
 */
export async function generateLegalDraftAction(
  projectId: string,
  kind: LegalKind,
): Promise<{ success: true; path: string } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  if (kind !== 'privacy' && kind !== 'terms') return { error: 'Unknown page type.' };

  const limit = await rateLimit(`legal-draft:${auth.userId}`, 6, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };

  const artifact = await prisma.artifact.findFirst({
    where: { projectId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, slug: true },
  });
  if (!artifact) return { error: 'Build your project first.' };

  const relativePath = LEGAL_FILES[kind];
  const existing = await listProjectFiles(projectId, artifact.slug);
  if (existing.some((f) => f.path === `${artifact.slug}/${relativePath}`)) {
    return { error: `${relativePath} already exists. Edit that file instead.` };
  }

  const { files } = await loadSiteFiles(projectId, 'WORKING');
  const draft = await generateLegalDraft(kind, {
    name: auth.project.name,
    description: auth.project.description,
    hasForms: files.some((f) => /<form[\s>]/i.test(f.content)),
    analytics: detectAnalytics(files),
    payments: detectPaymentProviders(files),
  }).catch(() => null);
  if (!draft) return { error: 'Could not generate a draft right now. Please try again.' };

  await writeProjectFile({
    projectId,
    artifactSlug: artifact.slug,
    artifactId: artifact.id,
    relativePath,
    content: draft,
  });
  revalidatePath(`/app/projects/${auth.project.workspace.slug}/${auth.project.slug}`);
  return { success: true, path: relativePath };
}

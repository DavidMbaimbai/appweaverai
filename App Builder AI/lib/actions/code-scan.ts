'use server';

import { revalidatePath } from 'next/cache';

import { getCachedSession } from '@/lib/auth/cached';
import { proposeFix } from '@/lib/code-scan/ai-fix';
import { decideApproval, requestApproval } from '@/lib/code-scan/approvals';
import { diagnoseFailure, type DiagnosisSource, type StoredDiagnosis } from '@/lib/code-scan/diagnosis';
import { getLatestRegression, runRegressionCheck, type StoredRegression } from '@/lib/code-scan/regression';
import { SCHEDULE_FREQUENCIES, setSchedule, type ScheduleFrequency, type StoredSchedule } from '@/lib/code-scan/schedule';
import {
  acknowledgeFinding,
  getLatestScan,
  isProjectOwner,
  runCodeScan,
  type StoredScan,
} from '@/lib/code-scan/service';
import { withCredits } from '@/lib/credits/with-credits';
import { prisma } from '@/lib/prisma';
import { getAccessibleProject } from '@/lib/projects/access';
import { rateLimit } from '@/lib/rate-limit';

async function authorize(projectId: string) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' } as const;
  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    slug: true,
    workspace: { select: { slug: true } },
  });
  if (!project) return { error: 'Project not found.' } as const;
  return { userId, project } as const;
}

function refresh(project: { slug: string; workspace: { slug: string } }) {
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}/security`);
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}/quality`);
}

const MAX_PASTED_LOG_CHARS = 20_000;

export async function runRegressionAction(projectId: string): Promise<{ regression: StoredRegression } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };

  const limit = await rateLimit(`code-regression:${auth.userId}`, 6, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Too many regression runs. Try again in ${limit.retryAfter}s.` };

  try {
    const regression = await runRegressionCheck({ projectId, userId: auth.userId });
    refresh(auth.project);
    return { regression };
  } catch {
    return { error: 'The regression check could not be recorded. Please try again.' };
  }
}

export async function requestApprovalAction(projectId: string): Promise<{ approvalId: string } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };

  const limit = await rateLimit(`code-approval-req:${auth.userId}`, 20, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Too many requests. Try again in ${limit.retryAfter}s.` };

  const result = await requestApproval({ projectId, userId: auth.userId });
  if (!result.ok) return { error: result.error };
  refresh(auth.project);
  return { approvalId: result.approvalId };
}

export async function decideApprovalAction(
  projectId: string,
  approvalId: string,
  decision: 'APPROVE' | 'REJECT',
  reason: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };
  if (decision !== 'APPROVE' && decision !== 'REJECT') return { error: 'Unknown decision.' };

  const result = await decideApproval({
    projectId,
    approvalId: String(approvalId),
    userId: auth.userId,
    decision,
    reason: String(reason ?? ''),
  });
  if (!result.ok) return { error: result.error };
  refresh(auth.project);
  return { success: true };
}

export async function setScheduleAction(
  projectId: string,
  enabled: boolean,
  frequency: ScheduleFrequency,
): Promise<{ schedule: StoredSchedule } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };
  if (!SCHEDULE_FREQUENCIES.includes(frequency)) return { error: 'Unknown frequency.' };

  const result = await setSchedule({ projectId, userId: auth.userId, enabled: Boolean(enabled), frequency });
  if (!result.ok) return { error: result.error };
  refresh(auth.project);
  return { schedule: result.schedule };
}

/** Diagnoses a failed build/deploy/regression. Credit-charged; the proposal is text only and never applied. */
export async function diagnoseFailureAction(
  projectId: string,
  source: DiagnosisSource,
  pastedLog?: string,
): Promise<{ diagnosis: StoredDiagnosis } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };
  if (source !== 'REGRESSION' && source !== 'BUILD' && source !== 'DEPLOY') return { error: 'Unknown source.' };

  const limit = await rateLimit(`code-diagnose:${auth.userId}`, 10, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };

  let rawLog = String(pastedLog ?? '').slice(0, MAX_PASTED_LOG_CHARS);
  if (source === 'REGRESSION') {
    const latest = await getLatestRegression(projectId);
    if (!latest || latest.status !== 'FAILED' || !latest.output) return { error: 'There is no failed regression output to diagnose.' };
    rawLog = latest.output;
  }
  if (rawLog.trim().length < 20) return { error: 'Paste the error output (at least a line or two).' };

  let outcome;
  try {
    outcome = await withCredits(
      auth.userId,
      'code_scan_diagnosis',
      () => diagnoseFailure({ projectId, userId: auth.userId, source, rawLog }),
      { refType: 'Project', refId: projectId },
    );
  } catch {
    return { error: 'Could not produce a diagnosis right now. Please try again.' };
  }
  if (!outcome.ok) return { error: outcome.error };
  refresh(auth.project);
  return { diagnosis: outcome.value };
}

export async function getLatestScanAction(projectId: string): Promise<{ scan: StoredScan | null } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };
  return { scan: await getLatestScan(projectId) };
}

export async function runCodeScanAction(projectId: string): Promise<{ scan: StoredScan } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };

  const limit = await rateLimit(`code-scan:${auth.userId}`, 15, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Too many scans. Try again in ${limit.retryAfter}s.` };

  try {
    const scan = await runCodeScan({ projectId, userId: auth.userId, trigger: 'MANUAL', source: 'WORKING' });
    refresh(auth.project);
    return { scan };
  } catch {
    return { error: 'The scan could not be completed. Please try again.' };
  }
}

/** Owner-only: records why a high/critical finding is acceptable so it stops blocking publish. */
export async function acknowledgeFindingAction(
  projectId: string,
  findingId: string,
  reason: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };
  if (!(await isProjectOwner(projectId, auth.userId))) {
    return { error: 'Only the project owner can acknowledge security findings.' };
  }
  const result = await acknowledgeFinding({ projectId, userId: auth.userId, findingId, reason: String(reason ?? '') });
  if (!result.ok) return { error: result.error };
  refresh(auth.project);
  return { success: true };
}

/** Asks the AI for a suggested fix. Stored on the finding as text; never applied to the project's files. */
export async function requestAiFixAction(
  projectId: string,
  findingId: string,
): Promise<{ proposal: string } | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { error: auth.error };

  const limit = await rateLimit(`code-scan-fix:${auth.userId}`, 20, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };

  const finding = await prisma.scanFinding.findFirst({ where: { id: findingId, projectId } });
  if (!finding) return { error: 'Finding not found.' };
  if (finding.fixProposal) return { proposal: finding.fixProposal };

  let outcome;
  try {
    outcome = await withCredits(
      auth.userId,
      'code_scan_fix',
      () =>
        proposeFix(projectId, {
          rule: finding.rule,
          severity: finding.severity,
          title: finding.title,
          message: finding.message,
          file: finding.file,
          line: finding.line,
        }),
      { refType: 'ScanFinding', refId: finding.id },
    );
  } catch {
    return { error: 'Could not generate a suggestion right now. Please try again.' };
  }
  if (!outcome.ok) return { error: outcome.error };

  await prisma.scanFinding.update({
    where: { id: finding.id },
    data: { fixProposal: outcome.value, fixProposedAt: new Date() },
  });
  refresh(auth.project);
  return { proposal: outcome.value };
}

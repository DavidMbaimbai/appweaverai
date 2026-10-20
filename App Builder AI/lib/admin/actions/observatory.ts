'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { refreshFeatureLedger } from '@/lib/observatory/understand';
import { runSmokeCheck } from '@/lib/observatory/smoke';
import { verifyIssue } from '@/lib/observatory/issues';
import { prisma } from '@/lib/prisma';

type ActionResult = { success: true; message?: string } | { error: string };

async function authorize() {
  const auth = await requireAdmin('observatory:write');
  return auth.ok ? auth.admin : null;
}

async function projectExists(projectId: string) {
  return Boolean(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }));
}

export async function refreshLedgerAction(projectId: string): Promise<ActionResult> {
  const admin = await authorize();
  if (!admin) return { error: 'Not authorized.' };
  if (!(await projectExists(projectId))) return { error: 'Project not found.' };

  const result = await refreshFeatureLedger(projectId).catch(() => null);
  if (!result) return { error: 'Could not rebuild the feature ledger.' };

  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'observatory.refresh_ledger',
    targetType: 'Project',
    targetId: projectId,
    after: { features: result.features },
  });
  revalidatePath(`/admin/observatory/${projectId}`);
  return { success: true, message: `Ledger rebuilt: ${result.features} features.` };
}

export async function runSmokeAction(projectId: string): Promise<ActionResult> {
  const admin = await authorize();
  if (!admin) return { error: 'Not authorized.' };

  const run = await runSmokeCheck(projectId).catch(() => null);
  if (!run) return { error: 'Smoke check failed to run.' };
  if ('skipped' in run) return { error: run.skipped ?? 'Skipped.' };

  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'observatory.run_smoke',
    targetType: 'Project',
    targetId: projectId,
    after: { outcome: run.result.outcome },
  });
  revalidatePath(`/admin/observatory/${projectId}`);
  return { success: true, message: `Smoke check: ${run.result.outcome}` };
}

export async function verifyIssueAdminAction(issueId: string): Promise<ActionResult> {
  const admin = await authorize();
  if (!admin) return { error: 'Not authorized.' };
  const issue = await prisma.projectIssue.findUnique({ where: { id: issueId }, select: { projectId: true } });
  if (!issue) return { error: 'Issue not found.' };

  const result = await verifyIssue(issueId);
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'observatory.verify_issue',
    targetType: 'ProjectIssue',
    targetId: issueId,
    after: { verified: result.verified },
  });
  revalidatePath(`/admin/observatory/${issue.projectId}`);
  return result.verified ? { success: true, message: 'Verified by a passing smoke check.' } : { error: result.reason };
}

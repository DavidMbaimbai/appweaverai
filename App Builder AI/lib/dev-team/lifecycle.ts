import { classifyRisk, decide } from '@/lib/agents/policy';
import { isGloballyPaused } from '@/lib/agents/pause';
import { redactSensitive } from '@/lib/agents/untrusted';
import { auditUserDecision } from '@/lib/code-scan/audit';
import { validateDecisionReason } from '@/lib/code-scan/approvals';
import { isProjectOwner } from '@/lib/code-scan/service';
import { loadLimitStatuses } from '@/lib/credits/limits';
import { isCreditMetered } from '@/lib/credits/with-credits';
import { prisma } from '@/lib/prisma';
import { createProjectCheckpoint } from '@/lib/project-checkpoints';
import { deleteProjectFile, normalizeRelativePath, readProjectFile, writeProjectFile } from '@/lib/project-files';
import { refreshCodeMap } from '@/lib/project-memory/code-map';
import { detectSecret } from '@/lib/project-memory/safety';
import { createMemory } from '@/lib/project-memory/store';

import { buildDevTeamEstimate, reserveRunCredits, settleRunCredits, type DevTeamEstimate } from './credits';
import { resolveLimits } from './dag';
import { addMessage, mergeRun, verifyRun } from './engine';
import { normaliseProposalPath } from './permissions';
import { ACTIVE_RUN_STATUSES, MAX_GOAL_CHARS, MIN_GOAL_CHARS } from './types';

type Fail = { ok: false; error: string };

export async function estimateForUser(userId: string, workspaceId: string): Promise<DevTeamEstimate> {
  const [user, spendLimits] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true, subscriptionPlan: true, subscriptionStatus: true } }),
    loadLimitStatuses(userId, workspaceId).catch(() => []),
  ]);
  return buildDevTeamEstimate({ limits: resolveLimits(), metered: isCreditMetered(user), balance: user?.creditBalance ?? 0, spendLimits });
}

export function validateGoal(goal: string): string | null {
  const trimmed = goal.trim();
  if (trimmed.length < MIN_GOAL_CHARS) return `Describe the goal in at least ${MIN_GOAL_CHARS} characters.`;
  if (trimmed.length > MAX_GOAL_CHARS) return `Keep the goal under ${MAX_GOAL_CHARS} characters.`;
  if (detectSecret(trimmed)) return 'The goal looks like it contains a secret or credential. Remove it and describe what you want instead.';
  return null;
}

/** Creates the run and reserves its credits. The caller then schedules executeRun() after responding. */
export async function startRun(args: { userId: string; projectId: string; workspaceId: string; goal: string }): Promise<{ ok: true; runId: string } | Fail> {
  if (await isGloballyPaused()) return { ok: false, error: 'AI agents are paused by the kill switch.' };
  const invalid = validateGoal(args.goal);
  if (invalid) return { ok: false, error: invalid };

  await reapStaleRuns(args.projectId);
  const active = await prisma.devTeamRun.findFirst({ where: { projectId: args.projectId, status: { in: [...ACTIVE_RUN_STATUSES] } }, select: { id: true } });
  if (active) return { ok: false, error: 'The AI team is already working on this project. Wait for it to finish or cancel it.' };

  const artifact = await prisma.artifact.findFirst({ where: { projectId: args.projectId }, orderBy: { sortOrder: 'asc' }, select: { slug: true } });
  if (!artifact) return { ok: false, error: 'This project has no files for the AI team to work on yet.' };

  const estimate = await estimateForUser(args.userId, args.workspaceId);
  if (estimate.blocked) return { ok: false, error: estimate.blocked.message };

  const run = await prisma.devTeamRun.create({
    data: {
      projectId: args.projectId,
      artifactSlug: artifact.slug,
      goal: args.goal.trim(),
      requestedById: args.userId,
      estimatedCredits: estimate.maxCredits,
    },
  });

  // Two simultaneous starts: only the oldest run survives.
  const oldest = await prisma.devTeamRun.findFirst({ where: { projectId: args.projectId, status: { in: [...ACTIVE_RUN_STATUSES] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  if (oldest && oldest.id !== run.id) {
    await prisma.devTeamRun.delete({ where: { id: run.id } });
    return { ok: false, error: 'The AI team is already working on this project.' };
  }

  const reservation = await reserveRunCredits({ userId: args.userId, workspaceId: args.workspaceId, runId: run.id, maxCredits: estimate.maxCredits });
  if (!reservation.ok) {
    await prisma.devTeamRun.delete({ where: { id: run.id } });
    return { ok: false, error: reservation.error };
  }
  await prisma.devTeamRun.update({ where: { id: run.id }, data: { reservedCredits: reservation.reserved, creditKey: reservation.creditKey } });
  await addMessage(run.id, { kind: 'SYSTEM', content: `Run started. Budget: up to ${reservation.reserved} credits (estimate).` });
  await auditUserDecision({ userId: args.userId, action: 'dev_team.run_started', targetType: 'Project', targetId: args.projectId, after: { runId: run.id, estimatedCredits: estimate.maxCredits } }).catch(() => null);
  return { ok: true, runId: run.id };
}

/** Runs that never finished (process died mid-run) are failed and refunded so credits are not stuck. */
export async function reapStaleRuns(projectId: string, now = Date.now()) {
  const limits = resolveLimits();
  const cutoff = new Date(now - (limits.runTimeoutMs + 120_000));
  const stale = await prisma.devTeamRun.findMany({ where: { projectId, status: { in: [...ACTIVE_RUN_STATUSES] }, updatedAt: { lt: cutoff } }, select: { id: true, creditKey: true, reservedCredits: true, spentCredits: true } });
  for (const run of stale) {
    const claimed = await prisma.devTeamRun.updateMany({
      where: { id: run.id, projectId, status: { in: [...ACTIVE_RUN_STATUSES] }, updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', error: 'The run stopped unexpectedly and was refunded.', finishedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    await prisma.devTeamTask.updateMany({ where: { runId: run.id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } });
    await settleRunCredits({ creditKey: run.creditKey, reserved: run.reservedCredits, spent: run.spentCredits, failed: true }).catch(() => null);
  }
}

export async function cancelRun(args: { userId: string; projectId: string; runId: string }): Promise<{ ok: true } | Fail> {
  const claimed = await prisma.devTeamRun.updateMany({ where: { id: args.runId, projectId: args.projectId, status: { in: [...ACTIVE_RUN_STATUSES] } }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  if (claimed.count === 0) return { ok: false, error: 'This run is not running.' };
  await addMessage(args.runId, { kind: 'SYSTEM', content: 'Run cancelled. Unfinished work is discarded and unused credits are returned.' });
  await auditUserDecision({ userId: args.userId, action: 'dev_team.run_cancelled', targetType: 'Project', targetId: args.projectId, after: { runId: args.runId } }).catch(() => null);
  return { ok: true };
}

export async function rejectRun(args: { userId: string; projectId: string; runId: string; reason: string }): Promise<{ ok: true } | Fail> {
  const invalid = validateDecisionReason(args.reason);
  if (invalid) return { ok: false, error: invalid };
  const claimed = await prisma.devTeamRun.updateMany({
    where: { id: args.runId, projectId: args.projectId, status: { in: ['NEEDS_DECISION', 'AWAITING_APPROVAL'] } },
    data: { status: 'REJECTED', decidedById: args.userId, decisionReason: args.reason.trim(), decidedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: 'This run is not waiting for a decision.' };
  await auditUserDecision({ userId: args.userId, action: 'dev_team.run_rejected', targetType: 'Project', targetId: args.projectId, reason: args.reason.trim(), after: { runId: args.runId } });
  return { ok: true };
}

export type ConflictChoice =
  | { kind: 'PROPOSAL'; proposalId: string }
  | { kind: 'SUGGESTION' }
  | { kind: 'MANUAL'; content: string }
  | { kind: 'DROP' };

/** A person decides a conflicted file. Nothing is chosen automatically. */
export async function resolveConflict(args: { userId: string; projectId: string; runId: string; path: string; choice: ConflictChoice }): Promise<{ ok: true } | Fail> {
  const limits = resolveLimits();
  const run = await prisma.devTeamRun.findFirst({ where: { id: args.runId, projectId: args.projectId, status: 'NEEDS_DECISION' }, select: { id: true } });
  if (!run) return { ok: false, error: 'This run has no conflicts waiting for a decision.' };
  const file = await prisma.devTeamMergedFile.findFirst({ where: { runId: args.runId, path: args.path, status: 'CONFLICT' } });
  if (!file) return { ok: false, error: 'That file is not in conflict.' };

  let data: { op?: 'CREATE' | 'MODIFY' | 'DELETE'; finalContent: string | null; baseHash?: string | null; baseContent?: string | null };
  const choice = args.choice;
  if (choice.kind === 'DROP') {
    await prisma.devTeamMergedFile.delete({ where: { id: file.id } });
    await addMessage(args.runId, { kind: 'CONFLICT', content: `${file.path}: changes dropped by a person.` });
    await audit(args, file.path, 'DROP');
    await verifyRun(args.runId, args.projectId);
    return { ok: true };
  }
  if (choice.kind === 'PROPOSAL') {
    const proposal = await prisma.devTeamChangeProposal.findFirst({ where: { id: choice.proposalId, runId: args.runId, path: file.path } });
    if (!proposal) return { ok: false, error: 'That proposal does not belong to this file.' };
    data = { op: proposal.op, finalContent: proposal.op === 'DELETE' ? null : proposal.proposedContent, baseHash: proposal.baseHash, baseContent: proposal.baseContent };
  } else if (choice.kind === 'SUGGESTION') {
    if (!file.suggestion) return { ok: false, error: 'There is no suggestion for this file.' };
    data = { op: 'MODIFY', finalContent: file.suggestion };
  } else {
    if (typeof choice.content !== 'string' || Buffer.byteLength(choice.content) > limits.maxFileBytes) return { ok: false, error: 'The content is missing or too large.' };
    data = { op: 'MODIFY', finalContent: choice.content };
  }
  await prisma.devTeamMergedFile.update({
    where: { id: file.id },
    data: { ...data, status: 'RESOLVED', resolution: choice.kind, resolvedById: args.userId, resolvedAt: new Date(), conflict: undefined },
  });
  await addMessage(args.runId, { kind: 'CONFLICT', content: `${file.path}: resolved by a person (${choice.kind.toLowerCase()}).` });
  await audit(args, file.path, choice.kind);
  await verifyRun(args.runId, args.projectId);
  return { ok: true };
}

async function audit(args: { userId: string; projectId: string; runId: string }, path: string, choice: string) {
  await auditUserDecision({ userId: args.userId, action: 'dev_team.conflict_resolved', targetType: 'Project', targetId: args.projectId, after: { runId: args.runId, path, choice } }).catch(() => null);
}

export type ApproveInput = {
  userId: string;
  projectId: string;
  runId: string;
  reason: string;
  acknowledgeNotRun: boolean;
  acknowledgeProtected: boolean;
};

/**
 * The only path that changes project files. Requires the owner, a reason, a clean fresh verification and explicit
 * acknowledgement that tests were not run. Takes a checkpoint first so the change can be undone.
 */
export async function approveAndApply(args: ApproveInput): Promise<{ ok: true; applied: string[]; checkpointCreated: boolean } | Fail> {
  if (!(await isProjectOwner(args.projectId, args.userId))) return { ok: false, error: 'Only the project owner can approve AI team changes.' };
  const invalid = validateDecisionReason(args.reason);
  if (invalid) return { ok: false, error: invalid };

  // Same policy gate as every agent action: apply is high risk, so it is only ever approval-driven, and the kill switch blocks it.
  const policy = decide({
    mode: 'APPROVAL',
    enabled: true,
    paused: false,
    category: 'dev_team_apply',
    actionRisk: classifyRisk(['sensitive_data_change']),
    withinLimits: true,
    globalPause: await isGloballyPaused(),
    scope: 'PROJECT',
  });
  if (policy.outcome === 'BLOCKED') return { ok: false, error: policy.reason };

  const run = await prisma.devTeamRun.findFirst({ where: { id: args.runId, projectId: args.projectId, status: 'AWAITING_APPROVAL' } });
  if (!run) return { ok: false, error: 'This run is not waiting for approval.' };

  const verification = await verifyRun(args.runId, args.projectId);
  if (!verification) return { ok: false, error: 'Verification could not run.' };
  if (!verification.canApprove) return { ok: false, error: `Cannot apply yet: ${verification.blockers.join(' ')}` };
  if (!args.acknowledgeNotRun) return { ok: false, error: 'Confirm that tests and build were not run on these changes.' };
  if (verification.protectedTouched.length > 0 && !args.acknowledgeProtected) return { ok: false, error: 'Confirm you reviewed the protected features these changes touch.' };

  const claimed = await prisma.devTeamRun.updateMany({
    where: { id: args.runId, projectId: args.projectId, status: 'AWAITING_APPROVAL', decidedAt: null },
    data: { decidedById: args.userId, decisionReason: args.reason.trim(), decidedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: 'This run was already decided.' };

  const files = await prisma.devTeamMergedFile.findMany({ where: { runId: args.runId, appliedAt: null, status: { in: ['CLEAN', 'MERGED', 'RESOLVED'] } } });
  const artifact = await prisma.artifact.findFirst({ where: { projectId: args.projectId, slug: run.artifactSlug }, select: { id: true } });
  const checkpoint = await createProjectCheckpoint({
    projectId: args.projectId,
    label: 'Before AI team changes',
    description: `Saved automatically before applying AI team run ${args.runId}.`,
    createdById: args.userId,
    isAutomatic: false,
  }).catch(() => null);

  const written: Array<{ path: string; previous: string | null }> = [];
  try {
    for (const file of files) {
      const check = normaliseProposalPath(file.path);
      if (!check.ok || normalizeRelativePath(file.path) !== check.path) throw new Error('Unsafe path.');
      const previous = await readProjectFile(args.projectId, run.artifactSlug, file.path).catch(() => null);
      if (file.op === 'DELETE') {
        await deleteProjectFile({ projectId: args.projectId, artifactSlug: run.artifactSlug, relativePath: file.path });
      } else {
        if (file.finalContent === null) throw new Error('Missing content.');
        await writeProjectFile({ projectId: args.projectId, artifactSlug: run.artifactSlug, artifactId: artifact?.id ?? null, relativePath: file.path, content: file.finalContent });
      }
      written.push({ path: file.path, previous: typeof previous === 'string' ? previous : null });
    }
  } catch (error) {
    console.error('[dev-team] apply failed, rolling back:', error);
    for (const item of written.reverse()) {
      if (item.previous === null) await deleteProjectFile({ projectId: args.projectId, artifactSlug: run.artifactSlug, relativePath: item.path }).catch(() => null);
      else await writeProjectFile({ projectId: args.projectId, artifactSlug: run.artifactSlug, artifactId: artifact?.id ?? null, relativePath: item.path, content: item.previous }).catch(() => null);
    }
    await prisma.devTeamRun.updateMany({ where: { id: args.runId, projectId: args.projectId }, data: { decidedById: null, decisionReason: null, decidedAt: null, error: 'Applying failed and was rolled back. Nothing was changed.' } });
    return { ok: false, error: 'Applying the changes failed and was rolled back. Nothing was changed.' };
  }

  const now = new Date();
  await prisma.devTeamMergedFile.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { status: 'APPLIED', appliedAt: now } });
  await prisma.devTeamRun.update({ where: { id: args.runId }, data: { status: 'APPLIED', appliedAt: now, error: null } });
  await addMessage(args.runId, { kind: 'SYSTEM', content: `Applied ${files.length} file(s) after approval by the project owner.` });

  const paths = files.map((f) => f.path);
  await auditUserDecision({
    userId: args.userId,
    action: 'dev_team.run_applied',
    targetType: 'Project',
    targetId: args.projectId,
    reason: args.reason.trim(),
    after: { runId: args.runId, files: paths, checkpointCreated: Boolean(checkpoint), scan: verification.scan.status, regression: verification.regression.status },
  });
  await createMemory({
    projectId: args.projectId,
    source: 'AGENT',
    createdById: args.userId,
    input: {
      type: 'DECISION',
      title: `AI team change: ${redactSensitive(run.goal).replace(/\s+/g, ' ').slice(0, 80)}`,
      body: `An AI development team run changed ${paths.length} file(s) after owner approval: ${paths.slice(0, 12).join(', ')}. Goal: ${redactSensitive(run.goal).slice(0, 400)}`,
      files: paths.slice(0, 12),
      confidence: 0.8,
    },
    evidence: { files: paths.slice(0, 12) },
  }).catch((e) => console.error('[dev-team] memory write failed:', e));
  await refreshCodeMap(args.projectId, run.artifactSlug).catch(() => null);
  return { ok: true, applied: paths, checkpointCreated: Boolean(checkpoint) };
}

export { mergeRun };

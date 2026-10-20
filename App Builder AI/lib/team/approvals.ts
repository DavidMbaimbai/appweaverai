import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { prisma } from '@/lib/prisma';

import { requireProjectCapability } from './access';
import { recordTeamEvent } from './events';
import { listMembers } from './members';
import { notifyUser } from './notifications';
import { can } from './permissions';

export type ApprovalResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

const KINDS = ['PUBLISH', 'MARKETING_CAMPAIGN', 'SPEND', 'OTHER'] as const;
type Kind = (typeof KINDS)[number];

async function projectLink(projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true, workspace: { select: { slug: true } } } });
  return p ? `${appBaseUrl()}/app/projects/${p.workspace.slug}/${p.slug}/board` : null;
}

/** Owners and admins (anyone with approve_spend) except the requester. */
export async function listApprovers(projectId: string, viewerId: string) {
  const members = await listMembers(viewerId, { projectId });
  return members.filter((m) => can(m.role, 'approve_spend'));
}

export async function requestApproval(input: {
  userId: string;
  projectId: string;
  taskId?: string | null;
  kind: string;
  title: string;
  details?: string | null;
  amountCredits?: number | null;
}): Promise<ApprovalResult<{ approvalId: string }>> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'request_approval');
  if (!access.ok) return fail(access.error);
  if (!(KINDS as readonly string[]).includes(input.kind)) return fail('Unknown approval type.');
  const title = input.title.trim();
  if (!title || title.length > 160) return fail('Give the request a short title.');
  if (input.amountCredits != null && (!Number.isInteger(input.amountCredits) || input.amountCredits < 0)) return fail('The amount must be a whole number of credits.');
  if (input.taskId) {
    const task = await prisma.boardTask.findFirst({ where: { id: input.taskId, projectId: input.projectId }, select: { id: true } });
    if (!task) return fail('Task not found.');
  }
  const approval = await prisma.teamApprovalRequest.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      kind: input.kind as Kind,
      title,
      details: input.details?.trim() || null,
      amountCredits: input.amountCredits ?? null,
      requestedById: input.userId,
    },
    select: { id: true },
  });
  await recordTeamEvent({ actorId: input.userId, action: 'approval.requested', target: { type: 'Project', id: input.projectId }, after: { approvalId: approval.id, kind: input.kind, title, amountCredits: input.amountCredits ?? null } });

  const href = await projectLink(input.projectId);
  for (const approver of await listApprovers(input.projectId, input.userId)) {
    await notifyUser({ userId: approver.userId, actorId: input.userId, kind: 'APPROVAL_REQUESTED', title: `Approval needed: ${title}`, body: input.details ?? undefined, href, projectId: input.projectId });
  }
  return { ok: true, approvalId: approval.id };
}

export async function decideApproval(input: {
  userId: string;
  projectId: string;
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  reason?: string | null;
}): Promise<ApprovalResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'approve_spend');
  if (!access.ok) return fail(access.error);
  const reason = input.reason?.trim() || null;
  if (input.decision === 'REJECTED' && !reason) return fail('Say why you are rejecting this request.');

  const approval = await prisma.teamApprovalRequest.findFirst({ where: { id: input.approvalId, projectId: input.projectId } });
  if (!approval) return fail('Approval request not found.');
  if (approval.requestedById === input.userId) return fail('You cannot decide your own request.');

  // Decided exactly once: only a PENDING row can transition.
  const decided = await prisma.teamApprovalRequest.updateMany({
    where: { id: approval.id, projectId: input.projectId, status: 'PENDING' },
    data: { status: input.decision, decidedById: input.userId, decisionReason: reason, decidedAt: new Date() },
  });
  if (decided.count !== 1) return fail('This request was already decided.');

  await recordTeamEvent({ actorId: input.userId, action: input.decision === 'APPROVED' ? 'approval.approved' : 'approval.rejected', target: { type: 'Project', id: input.projectId }, after: { approvalId: approval.id, title: approval.title, reason } });
  await notifyUser({
    userId: approval.requestedById,
    actorId: input.userId,
    kind: 'APPROVAL_DECIDED',
    title: `${input.decision === 'APPROVED' ? 'Approved' : 'Rejected'}: ${approval.title}`,
    body: reason ?? undefined,
    href: await projectLink(input.projectId),
    projectId: input.projectId,
  });
  return { ok: true };
}

export async function cancelApproval(input: { userId: string; projectId: string; approvalId: string }): Promise<ApprovalResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'request_approval');
  if (!access.ok) return fail(access.error);
  const r = await prisma.teamApprovalRequest.updateMany({
    where: { id: input.approvalId, projectId: input.projectId, requestedById: input.userId, status: 'PENDING' },
    data: { status: 'CANCELLED', decidedAt: new Date() },
  });
  if (r.count !== 1) return fail('Approval request not found.');
  await recordTeamEvent({ actorId: input.userId, action: 'approval.cancelled', target: { type: 'Project', id: input.projectId }, after: { approvalId: input.approvalId } });
  return { ok: true };
}

export async function listApprovals(userId: string, projectId: string, opts: { status?: string } = {}) {
  const access = await requireProjectCapability(userId, projectId, 'view_project');
  if (!access.ok) return [];
  const rows = await prisma.teamApprovalRequest.findMany({
    where: { projectId, ...(opts.status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(opts.status) ? { status: opts.status as 'PENDING' } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const names = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } }, select: { id: true, name: true, email: true } });
  const label = (id: string | null) => {
    const u = names.find((n) => n.id === id);
    return u ? (u.name ?? u.email ?? id) : null;
  };
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    kind: r.kind,
    title: r.title,
    details: r.details,
    amountCredits: r.amountCredits,
    status: r.status,
    requestedBy: label(r.requestedById),
    requestedById: r.requestedById,
    decidedBy: label(r.decidedById),
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}

import { prisma } from '@/lib/prisma';

import { requireWorkspaceCapability, resolveWorkspaceRole } from './access';
import { recordTeamEvent } from './events';
import type { TeamResult } from './invitations';

const fail = (error: string) => ({ ok: false, error }) as const;

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** What a reservation currently costs its member: open = the held maximum, settled = what was charged, released/refunded = nothing. */
export function effectiveCredits(r: { status: string; maxCredits: number; settledCredits: number | null } | undefined): number {
  if (!r) return 0;
  if (r.status === 'RESERVED') return r.maxCredits;
  if (r.status === 'SETTLED') return r.settledCredits ?? r.maxCredits;
  return 0;
}

/** Pure: would `used` credits breach `limit`? A null limit means unlimited. */
export function exceedsLimit(limit: number | null | undefined, used: number) {
  return limit != null && used > limit;
}

/** Credits attributed to members of a workspace since `since`, per user, from the shared wallet's reservations. */
export async function memberUsage(workspaceId: string, since: Date, userId?: string) {
  const events = await prisma.workspaceUsageEvent.findMany({
    where: { workspaceId, createdAt: { gte: since }, ...(userId ? { userId } : {}) },
    select: { userId: true, ledgerKey: true, operation: true },
  });
  const reservations = await prisma.marketingReservation.findMany({
    where: { idempotencyKey: { in: events.map((e) => e.ledgerKey) } },
    select: { idempotencyKey: true, status: true, maxCredits: true, settledCredits: true },
  });
  const byKey = new Map(reservations.map((r) => [r.idempotencyKey, r]));
  const totals = new Map<string, { credits: number; operations: number }>();
  for (const e of events) {
    const credits = effectiveCredits(byKey.get(e.ledgerKey));
    const t = totals.get(e.userId) ?? { credits: 0, operations: 0 };
    t.credits += credits;
    if (credits > 0) t.operations += 1;
    totals.set(e.userId, t);
  }
  return totals;
}

/**
 * Called by `withMarketingCredits` right after the shared-wallet reservation succeeds. Records who is spending and
 * re-checks that member's monthly limit including this reservation; concurrent requests therefore cannot both slip under it.
 */
export async function attributeAndCheckMember(input: {
  workspaceId: string;
  userId: string;
  projectId: string | null;
  operation: string;
  ledgerKey: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; limit: number }> {
  await prisma.workspaceUsageEvent.upsert({
    where: { ledgerKey: input.ledgerKey },
    create: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId,
      operation: input.operation,
      credits: 0,
      ledgerKey: input.ledgerKey,
    },
    update: {},
  });
  const limitRow = await prisma.memberSpendLimit.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
    select: { monthlyLimit: true },
  });
  if (!limitRow) return { ok: true };
  const used = (await memberUsage(input.workspaceId, monthStart(input.now), input.userId)).get(input.userId)?.credits ?? 0;
  if (!exceedsLimit(limitRow.monthlyLimit, used)) return { ok: true };
  await prisma.workspaceUsageEvent.deleteMany({ where: { ledgerKey: input.ledgerKey } });
  return { ok: false, limit: limitRow.monthlyLimit };
}

export async function setMemberSpendLimit(input: {
  actorId: string;
  workspaceId: string;
  userId: string;
  monthlyLimit: number | null;
}): Promise<TeamResult> {
  const access = await requireWorkspaceCapability(input.actorId, input.workspaceId, 'manage_members');
  if (!access.ok) return fail(access.error);
  if (input.monthlyLimit !== null && (!Number.isInteger(input.monthlyLimit) || input.monthlyLimit < 0 || input.monthlyLimit > 10_000_000)) {
    return fail('The limit must be a whole number of credits.');
  }
  const target = await resolveWorkspaceRole(input.userId, input.workspaceId);
  if (!target) return fail('Member not found.');
  if (target.workspaceOwnerId === input.userId) return fail('The billing owner has no spending limit.');

  const before = await prisma.memberSpendLimit.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
    select: { monthlyLimit: true },
  });
  if (input.monthlyLimit === null) {
    await prisma.memberSpendLimit.deleteMany({ where: { workspaceId: input.workspaceId, userId: input.userId } });
  } else {
    await prisma.memberSpendLimit.upsert({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
      create: { workspaceId: input.workspaceId, userId: input.userId, monthlyLimit: input.monthlyLimit, setById: input.actorId },
      update: { monthlyLimit: input.monthlyLimit, setById: input.actorId },
    });
  }
  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.spend_limit_changed',
    target: { type: 'Workspace', id: input.workspaceId },
    before: { userId: input.userId, monthlyLimit: before?.monthlyLimit ?? null },
    after: { userId: input.userId, monthlyLimit: input.monthlyLimit },
  });
  return { ok: true };
}

export type UsageRow = {
  userId: string;
  name: string | null;
  email: string | null;
  marketingCredits: number;
  marketingOperations: number;
  monthlyLimit: number | null;
  developmentCredits: number;
};

/** Workspace usage table: shared marketing wallet spend per member this month, plus each member's own development credits on this workspace's projects. */
export async function getWorkspaceUsage(viewerId: string, workspaceId: string, now = new Date()): Promise<TeamResult<{ rows: UsageRow[]; since: string }>> {
  const access = await requireWorkspaceCapability(viewerId, workspaceId, 'view_billing');
  if (!access.ok) return fail(access.error);
  const since = monthStart(now);
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true, members: { select: { userId: true } }, projects: { select: { id: true } } },
  });
  if (!workspace) return fail('Workspace not found.');

  const usage = await memberUsage(workspaceId, since);
  const limits = await prisma.memberSpendLimit.findMany({ where: { workspaceId }, select: { userId: true, monthlyLimit: true } });
  const ids = [...new Set([workspace.ownerId, ...workspace.members.map((m) => m.userId), ...usage.keys()])];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });

  const dev = await prisma.creditLedger.groupBy({
    by: ['userId'],
    where: {
      userId: { in: ids },
      createdAt: { gte: since },
      delta: { lt: 0 },
      refType: 'Project',
      refId: { in: workspace.projects.map((p) => p.id) },
    },
    _sum: { delta: true },
  });

  const rows = users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    marketingCredits: usage.get(u.id)?.credits ?? 0,
    marketingOperations: usage.get(u.id)?.operations ?? 0,
    monthlyLimit: limits.find((l) => l.userId === u.id)?.monthlyLimit ?? null,
    developmentCredits: -(dev.find((d) => d.userId === u.id)?._sum.delta ?? 0),
  }));
  rows.sort((a, b) => b.marketingCredits - a.marketingCredits);
  return { ok: true, rows, since: since.toISOString() };
}

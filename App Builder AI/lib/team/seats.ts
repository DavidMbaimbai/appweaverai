import { getAppTier, type AppTier } from '@/lib/billing/entitlements';
import { prisma } from '@/lib/prisma';

const FREE_SEATS = 2;
const PRO_SEATS = 10;

/** Seats a plan includes (owner counts as one). `TEAM_SEATS_PRO` / `TEAM_SEATS_FREE` override the defaults. */
export function seatLimitForTier(tier: AppTier, env: NodeJS.ProcessEnv = process.env): number {
  const raw = tier === 'pro' ? env.TEAM_SEATS_PRO : env.TEAM_SEATS_FREE;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return tier === 'pro' ? PRO_SEATS : FREE_SEATS;
}

/** Pure: whether `extra` more seats fit. */
export function seatsAvailable(usage: { used: number; pending: number; limit: number }, extra = 1) {
  return usage.used + usage.pending + extra <= usage.limit;
}

export async function getSeatUsage(workspaceId: string, opts: { ignoreInvitationId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerId: true,
      owner: { select: { subscriptionPlan: true, subscriptionStatus: true } },
      members: { select: { userId: true } },
      projects: { select: { members: { select: { userId: true } } } },
    },
  });
  if (!workspace) return null;

  const people = new Set<string>([workspace.ownerId, ...workspace.members.map((m) => m.userId)]);
  for (const project of workspace.projects) for (const m of project.members) people.add(m.userId);

  const pendingRows = await prisma.teamInvitation.findMany({
    where: {
      workspaceId,
      status: 'PENDING',
      expiresAt: { gt: now },
      ...(opts.ignoreInvitationId ? { id: { not: opts.ignoreInvitationId } } : {}),
    },
    select: { email: true },
  });
  const pending = new Set(pendingRows.map((r) => r.email.toLowerCase())).size;
  return {
    used: people.size,
    pending,
    limit: seatLimitForTier(getAppTier(workspace.owner)),
  };
}

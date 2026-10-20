import { prisma } from '@/lib/prisma';

import { resolveWorkspaceRole } from './access';
import { recordTeamEvent } from './events';
import type { TeamResult } from './invitations';
import { notifyUser } from './notifications';

const fail = (error: string) => ({ ok: false, error }) as const;

/**
 * Hands a team workspace (and with it the shared marketing wallet and billing identity, which follow
 * `Workspace.ownerId`) to an existing member. The previous owner stays on as ADMIN. Compare-and-set on
 * `ownerId` makes concurrent transfers safe; `confirmSlug` guards against accidental clicks.
 */
export async function transferWorkspaceOwnership(input: {
  actorId: string;
  workspaceId: string;
  newOwnerId: string;
  confirmSlug: string;
}): Promise<TeamResult> {
  const ctx = await resolveWorkspaceRole(input.actorId, input.workspaceId);
  if (!ctx || ctx.role !== 'OWNER') return fail('Only the workspace owner can transfer ownership.');
  if (input.newOwnerId === input.actorId) return fail('You already own this workspace.');

  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { slug: true, type: true, name: true },
  });
  if (!workspace) return fail('Workspace not found.');
  if (workspace.type !== 'TEAM') return fail('Personal workspaces cannot be transferred.');
  if (input.confirmSlug.trim() !== workspace.slug) return fail('Type the workspace slug to confirm the transfer.');

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.newOwnerId } },
    select: { userId: true, user: { select: { emailVerified: true } } },
  });
  if (!member) return fail('The new owner must already be a member of this workspace.');
  if (!member.user.emailVerified) return fail('The new owner must have a verified email address.');

  const done = await prisma.$transaction(async (tx) => {
    const moved = await tx.workspace.updateMany({
      where: { id: input.workspaceId, ownerId: input.actorId },
      data: { ownerId: input.newOwnerId },
    });
    if (moved.count !== 1) return false;
    await tx.workspaceMember.deleteMany({ where: { workspaceId: input.workspaceId, userId: input.newOwnerId } });
    await tx.teamRoleAssignment.deleteMany({ where: { workspaceId: input.workspaceId, userId: input.newOwnerId } });
    await tx.memberSpendLimit.deleteMany({ where: { workspaceId: input.workspaceId, userId: input.newOwnerId } });
    await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.actorId } },
      create: { workspaceId: input.workspaceId, userId: input.actorId, role: 'ADMIN' },
      update: { role: 'ADMIN' },
    });
    await tx.teamRoleAssignment.upsert({
      where: { workspaceId_scopeKey_userId: { workspaceId: input.workspaceId, scopeKey: 'ws', userId: input.actorId } },
      create: { workspaceId: input.workspaceId, scopeKey: 'ws', userId: input.actorId, role: 'ADMIN', assignedById: input.actorId },
      update: { role: 'ADMIN' },
    });
    return true;
  });
  if (!done) return fail('Ownership changed while you were transferring. Reload and try again.');

  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.ownership_transferred',
    target: { type: 'Workspace', id: input.workspaceId },
    before: { ownerId: input.actorId },
    after: { ownerId: input.newOwnerId },
  });
  await notifyUser({
    userId: input.newOwnerId,
    actorId: input.actorId,
    kind: 'INVITATION',
    title: `You now own ${workspace.name}`,
    body: 'You are the billing owner: the shared marketing credit wallet and plan seats are now yours.',
  });
  return { ok: true };
}

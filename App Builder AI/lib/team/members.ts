import { prisma } from '@/lib/prisma';

import {
  requireProjectCapability,
  requireWorkspaceCapability,
  resolveProjectRole,
  resolveWorkspaceRole,
} from './access';
import { recordTeamEvent } from './events';
import { notifyUser } from './notifications';
import {
  ROLE_LABELS,
  canGrantRole,
  canManageMember,
  isTeamRole,
  legacyProjectRoleFor,
  legacyWorkspaceRoleFor,
  type TeamRoleName,
} from './permissions';
import type { TeamResult } from './invitations';

const fail = (error: string) => ({ ok: false, error }) as const;

type MemberScope = { workspaceId?: string | null; projectId?: string | null };

async function authorize(actorId: string, scope: MemberScope) {
  if (scope.projectId) {
    const access = await requireProjectCapability(actorId, scope.projectId, 'manage_members');
    return access.ok
      ? ({ ok: true, workspaceId: access.ctx.workspaceId, projectId: access.ctx.projectId, actorRole: access.ctx.role, ownerId: access.ctx.workspaceOwnerId } as const)
      : fail(access.error);
  }
  if (scope.workspaceId) {
    const access = await requireWorkspaceCapability(actorId, scope.workspaceId, 'manage_members');
    return access.ok
      ? ({ ok: true, workspaceId: access.ctx.workspaceId, projectId: null, actorRole: access.ctx.role, ownerId: access.ctx.workspaceOwnerId } as const)
      : fail(access.error);
  }
  return fail('Choose a workspace or project.');
}

export type MemberRow = { userId: string; name: string | null; email: string | null; role: TeamRoleName; isOwner: boolean };

/** Everyone with access in the scope, with their effective role. Requires membership (not manage_members) to read. */
export async function listMembers(viewerId: string, scope: MemberScope): Promise<MemberRow[]> {
  let workspaceId: string;
  let projectId: string | null = null;
  if (scope.projectId) {
    const ctx = await resolveProjectRole(viewerId, scope.projectId);
    if (!ctx) return [];
    workspaceId = ctx.workspaceId;
    projectId = ctx.projectId;
  } else if (scope.workspaceId) {
    const ctx = await resolveWorkspaceRole(viewerId, scope.workspaceId);
    if (!ctx) return [];
    workspaceId = ctx.workspaceId;
  } else return [];

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerId: true,
      members: { select: { userId: true } },
      projects: projectId ? { where: { id: projectId }, select: { members: { select: { userId: true } } } } : { select: { members: { select: { userId: true } } } },
    },
  });
  if (!workspace) return [];
  const ids = new Set<string>([workspace.ownerId, ...workspace.members.map((m) => m.userId)]);
  for (const p of workspace.projects) for (const m of p.members) ids.add(m.userId);

  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, email: true } });
  const rows: MemberRow[] = [];
  for (const user of users) {
    const ctx = projectId ? await resolveProjectRole(user.id, projectId) : await resolveWorkspaceRole(user.id, workspaceId);
    if (!ctx) continue;
    rows.push({ userId: user.id, name: user.name, email: user.email, role: ctx.role, isOwner: user.id === workspace.ownerId });
  }
  return rows.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function changeMemberRole(input: {
  actorId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  targetUserId: string;
  role: string;
}): Promise<TeamResult> {
  if (!isTeamRole(input.role)) return fail('Unknown role.');
  const auth = await authorize(input.actorId, input);
  if (!auth.ok) return auth;
  if (input.targetUserId === input.actorId) return fail('You cannot change your own role.');
  if (input.targetUserId === auth.ownerId) return fail('The workspace owner cannot be changed. Transfer ownership instead.');
  if (!canGrantRole(auth.actorRole, input.role)) {
    return fail(input.role === 'OWNER' ? 'Ownership can only be transferred.' : 'You cannot grant a role above your own.');
  }

  const current = auth.projectId
    ? await resolveProjectRole(input.targetUserId, auth.projectId)
    : await resolveWorkspaceRole(input.targetUserId, auth.workspaceId);
  if (!current) return fail('Member not found.');
  if (!canManageMember(auth.actorRole, current.role)) return fail('You cannot change a member who outranks you.');

  const scopeKey = auth.projectId ? `p:${auth.projectId}` : 'ws';
  await prisma.$transaction(async (tx) => {
    await tx.teamRoleAssignment.upsert({
      where: { workspaceId_scopeKey_userId: { workspaceId: auth.workspaceId, scopeKey, userId: input.targetUserId } },
      create: { workspaceId: auth.workspaceId, projectId: auth.projectId, scopeKey, userId: input.targetUserId, role: input.role as TeamRoleName, assignedById: input.actorId },
      update: { role: input.role as TeamRoleName, assignedById: input.actorId },
    });
    // Keep the legacy membership row aligned so older access checks agree about read vs write.
    if (auth.projectId) {
      await tx.projectMember.updateMany({
        where: { projectId: auth.projectId, userId: input.targetUserId },
        data: { role: legacyProjectRoleFor(input.role as TeamRoleName) },
      });
    } else {
      await tx.workspaceMember.updateMany({
        where: { workspaceId: auth.workspaceId, userId: input.targetUserId },
        data: { role: legacyWorkspaceRoleFor(input.role as TeamRoleName) },
      });
    }
  });

  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.member_role_changed',
    target: auth.projectId ? { type: 'Project', id: auth.projectId } : { type: 'Workspace', id: auth.workspaceId },
    before: { userId: input.targetUserId, role: current.role },
    after: { userId: input.targetUserId, role: input.role },
  });
  await notifyUser({
    userId: input.targetUserId,
    actorId: input.actorId,
    kind: 'INVITATION',
    title: `Your role changed to ${ROLE_LABELS[input.role as TeamRoleName]}`,
    projectId: auth.projectId,
  });
  return { ok: true };
}

async function removeAccess(workspaceId: string, projectId: string | null, userId: string) {
  await prisma.$transaction(async (tx) => {
    if (projectId) {
      await tx.projectMember.deleteMany({ where: { projectId, userId } });
      await tx.teamRoleAssignment.deleteMany({ where: { workspaceId, scopeKey: `p:${projectId}`, userId } });
      await tx.boardTask.updateMany({ where: { projectId, assigneeId: userId }, data: { assigneeId: null } });
      return;
    }
    const projectIds = (await tx.project.findMany({ where: { workspaceId }, select: { id: true } })).map((p) => p.id);
    await tx.workspaceMember.deleteMany({ where: { workspaceId, userId } });
    await tx.projectMember.deleteMany({ where: { projectId: { in: projectIds }, userId } });
    await tx.teamRoleAssignment.deleteMany({ where: { workspaceId, userId } });
    await tx.memberSpendLimit.deleteMany({ where: { workspaceId, userId } });
    await tx.boardTask.updateMany({ where: { projectId: { in: projectIds }, assigneeId: userId }, data: { assigneeId: null } });
  });
}

export async function removeMember(input: {
  actorId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  targetUserId: string;
}): Promise<TeamResult> {
  const auth = await authorize(input.actorId, input);
  if (!auth.ok) return auth;
  if (input.targetUserId === auth.ownerId) return fail('The workspace owner cannot be removed. Transfer ownership first.');

  const current = auth.projectId
    ? await resolveProjectRole(input.targetUserId, auth.projectId)
    : await resolveWorkspaceRole(input.targetUserId, auth.workspaceId);
  if (!current) return fail('Member not found.');
  if (!canManageMember(auth.actorRole, current.role)) return fail('You cannot remove a member who outranks you.');

  await removeAccess(auth.workspaceId, auth.projectId, input.targetUserId);
  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.member_removed',
    target: auth.projectId ? { type: 'Project', id: auth.projectId } : { type: 'Workspace', id: auth.workspaceId },
    before: { userId: input.targetUserId, role: current.role },
  });
  return { ok: true };
}

/** A member leaves on their own. The owner cannot: ownership must be transferred first (last-owner protection). */
export async function leaveWorkspace(input: { userId: string; workspaceId: string }): Promise<TeamResult> {
  const ctx = await resolveWorkspaceRole(input.userId, input.workspaceId);
  if (!ctx) return fail('Workspace not found.');
  if (ctx.workspaceOwnerId === input.userId) return fail('Transfer ownership before leaving the workspace.');
  await removeAccess(input.workspaceId, null, input.userId);
  await recordTeamEvent({
    actorId: input.userId,
    action: 'team.member_left',
    target: { type: 'Workspace', id: input.workspaceId },
    before: { userId: input.userId, role: ctx.role },
  });
  return { ok: true };
}

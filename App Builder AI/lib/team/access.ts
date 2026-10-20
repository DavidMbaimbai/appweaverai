import { prisma } from '@/lib/prisma';

import {
  can,
  deriveEffectiveRole,
  isTeamRole,
  type Capability,
  type LegacyProjectRole,
  type LegacyWorkspaceRole,
  type TeamRoleName,
} from './permissions';

export type ProjectRoleContext = {
  role: TeamRoleName;
  projectId: string;
  workspaceId: string;
  workspaceOwnerId: string;
};

export type WorkspaceRoleContext = { role: TeamRoleName; workspaceId: string; workspaceOwnerId: string };

export type AccessResult<T> = ({ ok: true } & T) | { ok: false; error: string; status: 403 | 404 };

const NOT_FOUND = { ok: false, error: 'Project not found.', status: 404 } as const;

function asRole(value: string | null | undefined): TeamRoleName | null {
  return isTeamRole(value) ? value : null;
}

/** The caller's effective role in a project, or null when they have no access (tenant boundary). */
export async function resolveProjectRole(userId: string, projectId: string): Promise<ProjectRoleContext | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      workspaceId: true,
      workspace: {
        select: { ownerId: true, members: { where: { userId }, select: { role: true } } },
      },
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project) return null;

  const assignments = await prisma.teamRoleAssignment.findMany({
    where: {
      userId,
      workspaceId: project.workspaceId,
      scopeKey: { in: ['ws', `p:${project.id}`] },
    },
    select: { scopeKey: true, role: true },
  });
  const role = deriveEffectiveRole({
    isWorkspaceOwner: project.workspace.ownerId === userId,
    workspaceMemberRole: (project.workspace.members[0]?.role as LegacyWorkspaceRole | undefined) ?? null,
    projectMemberRole: (project.members[0]?.role as LegacyProjectRole | undefined) ?? null,
    projectAssignment: asRole(assignments.find((a) => a.scopeKey === `p:${project.id}`)?.role),
    workspaceAssignment: asRole(assignments.find((a) => a.scopeKey === 'ws')?.role),
  });
  if (!role) return null;
  return { role, projectId: project.id, workspaceId: project.workspaceId, workspaceOwnerId: project.workspace.ownerId };
}

/** Role in the workspace itself (project-level overrides do not apply to workspace administration). */
export async function resolveWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRoleContext | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerId: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!workspace) return null;
  const assignment = await prisma.teamRoleAssignment.findUnique({
    where: { workspaceId_scopeKey_userId: { workspaceId, scopeKey: 'ws', userId } },
    select: { role: true },
  });
  const role = deriveEffectiveRole({
    isWorkspaceOwner: workspace.ownerId === userId,
    workspaceMemberRole: (workspace.members[0]?.role as LegacyWorkspaceRole | undefined) ?? null,
    workspaceAssignment: asRole(assignment?.role),
  });
  return role ? { role, workspaceId: workspace.id, workspaceOwnerId: workspace.ownerId } : null;
}

/** Guard for server actions and routes: access to the project AND the capability. Missing access reads as "not found". */
export async function requireProjectCapability(
  userId: string,
  projectId: string,
  capability: Capability,
): Promise<AccessResult<{ ctx: ProjectRoleContext }>> {
  const ctx = await resolveProjectRole(userId, projectId);
  if (!ctx) return NOT_FOUND;
  if (!can(ctx.role, capability)) {
    return { ok: false, error: 'Your role does not allow this action.', status: 403 };
  }
  return { ok: true, ctx };
}

export async function requireWorkspaceCapability(
  userId: string,
  workspaceId: string,
  capability: Capability,
): Promise<AccessResult<{ ctx: WorkspaceRoleContext }>> {
  const ctx = await resolveWorkspaceRole(userId, workspaceId);
  if (!ctx) return { ok: false, error: 'Workspace not found.', status: 404 };
  if (!can(ctx.role, capability)) {
    return { ok: false, error: 'Your role does not allow this action.', status: 403 };
  }
  return { ok: true, ctx };
}

import { getAccessibleProject } from '@/lib/projects/access';

export type MemoryRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export type MemoryAccessFacts = {
  userId: string;
  createdById: string;
  workspaceOwnerId: string;
  projectRole: string | null;
  workspaceRole: string | null;
};

/** Members can read; the owner, creator and editor-level roles can write. */
export function resolveMemoryRole(facts: MemoryAccessFacts): MemoryRole {
  if (facts.workspaceOwnerId === facts.userId || facts.createdById === facts.userId) return 'OWNER';
  if (facts.projectRole === 'OWNER') return 'OWNER';
  if (facts.projectRole === 'EDITOR' || facts.projectRole === 'PUBLISHER') return 'EDITOR';
  if (facts.projectRole === 'VIEWER') return 'VIEWER';
  if (facts.workspaceRole === 'ADMIN') return 'OWNER';
  if (facts.workspaceRole === 'MEMBER') return 'EDITOR';
  return 'VIEWER';
}

export type MemoryAccess = {
  userId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  workspaceSlug: string;
  role: MemoryRole;
  canWrite: boolean;
};

/** Resolves project access through the central helper (404-equivalent null when the user has none). */
export async function getMemoryAccess(projectId: string, userId: string): Promise<MemoryAccess | null> {
  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    name: true,
    slug: true,
    createdById: true,
    workspace: { select: { slug: true, ownerId: true, members: { where: { userId }, select: { role: true } } } },
    members: { where: { userId }, select: { role: true } },
  });
  if (!project) return null;
  const role = resolveMemoryRole({
    userId,
    createdById: project.createdById,
    workspaceOwnerId: project.workspace.ownerId,
    projectRole: project.members[0]?.role ?? null,
    workspaceRole: project.workspace.members[0]?.role ?? null,
  });
  return {
    userId,
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    workspaceSlug: project.workspace.slug,
    role,
    canWrite: role !== 'VIEWER',
  };
}

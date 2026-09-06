import { getAccessibleProject } from '@/lib/projects/access';
import { prisma } from '@/lib/prisma';

const authorizedProjectSelect = {
  id: true,
  name: true,
  description: true,
  conversations: {
    orderBy: { updatedAt: 'desc' as const },
    take: 1,
    select: { id: true },
  },
  artifacts: {
    orderBy: { sortOrder: 'asc' as const },
    select: { id: true, type: true, name: true, slug: true },
  },
} as const;

export async function getAuthorizedProject(projectId: string, userId: string) {
  return getAccessibleProject(projectId, userId, authorizedProjectSelect);
}

export async function ensureConversation(projectId: string, userId: string) {
  const existing = await prisma.agentConversation.findFirst({
    where: { projectId, userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await prisma.agentConversation.create({
    data: {
      projectId,
      userId,
      title: 'New conversation',
    },
    select: { id: true },
  });

  return created.id;
}

export async function getArtifactForProject(
  projectId: string,
  artifactId: string,
) {
  return prisma.artifact.findFirst({
    where: { id: artifactId, projectId },
    select: { id: true, type: true, name: true, slug: true },
  });
}

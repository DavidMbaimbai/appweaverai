import { prisma } from '@/lib/prisma';
import { hasProjectAccess, projectAccessWhere } from '@/lib/projects/access';

export async function authorizePreviewAccess(
  projectId: string,
  userId: string | null,
) {
  if (userId && (await hasProjectAccess(projectId, userId))) {
    return { allowed: true as const };
  }

  const publicDeployment = await prisma.deployment.findFirst({
    where: {
      projectId,
      isCurrent: true,
      status: 'LIVE',
      visibility: 'PUBLIC',
    },
    select: { id: true },
  });

  if (publicDeployment) {
    return { allowed: true as const };
  }

  if (userId) {
    const workspaceProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        deployments: {
          some: {
            isCurrent: true,
            status: 'LIVE',
            visibility: 'WORKSPACE_ONLY',
          },
        },
        ...projectAccessWhere(userId),
      },
      select: { id: true },
    });

    if (workspaceProject) {
      return { allowed: true as const };
    }
  }

  return { allowed: false as const };
}

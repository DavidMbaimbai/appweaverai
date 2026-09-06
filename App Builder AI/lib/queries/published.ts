import type { DeploymentVisibility } from '@/lib/generated/prisma/client';
import { fromDeploymentVisibility } from '@/lib/publish/visibility';
import { prisma } from '@/lib/prisma';

export async function getPublishedProjectBySlugs(
  workspaceSlug: string,
  projectSlug: string,
  userId?: string | null,
) {
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      deletedAt: null,
      workspace: { slug: workspaceSlug },
      deployments: { some: { isCurrent: true, status: 'LIVE' } },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      workspace: {
        select: {
          slug: true,
          ownerId: true,
          members: { select: { userId: true } },
        },
      },
      artifacts: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, slug: true, name: true, type: true },
      },
      deployments: {
        where: { isCurrent: true, status: 'LIVE' },
        take: 1,
        select: { visibility: true, domain: true },
      },
      members: { select: { userId: true } },
    },
  });

  if (!project) return null;

  const deployment = project.deployments[0];
  if (!deployment) return null;

  const visibility = deployment.visibility;
  const allowed = canAccessPublishedProject(project, visibility, userId);
  if (!allowed) return { forbidden: true as const, visibility };

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    workspaceSlug: project.workspace.slug,
    mainArtifact: project.artifacts[0] ?? null,
    visibility: fromDeploymentVisibility(visibility),
    publishedUrl: deployment.domain,
  };
}

function canAccessPublishedProject(
  project: {
    workspace: { ownerId: string; members: { userId: string }[] };
    members: { userId: string }[];
  },
  visibility: DeploymentVisibility,
  userId?: string | null,
) {
  if (visibility === 'PUBLIC') return true;
  if (!userId) return false;

  const isWorkspaceMember =
    project.workspace.ownerId === userId ||
    project.workspace.members.some((member) => member.userId === userId);
  const isProjectMember = project.members.some(
    (member) => member.userId === userId,
  );

  if (visibility === 'WORKSPACE_ONLY') {
    return isWorkspaceMember || isProjectMember;
  }

  return isProjectMember || isWorkspaceMember;
}

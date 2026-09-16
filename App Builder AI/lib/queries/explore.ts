import { prisma } from '../prisma';

export type PublicProjectSummary = {
  projectId: string;
  name: string;
  slug: string;
  workspaceSlug: string;
  publishedUrl: string;
  mainArtifactSlug: string | null;
  previewImageUrl: string | null;
  publishedAt: string | null;
};

/**
 * Lists the most recently published PUBLIC projects across the whole app,
 * for the "Explore" gallery where any signed-in user can browse and remix
 * ideas (Lovable-style community discovery).
 */
export async function listPublicProjects(
  options: { limit?: number } = {},
): Promise<PublicProjectSummary[]> {
  const limit = options.limit ?? 24;

  const deployments = await prisma.deployment.findMany({
    where: {
      isCurrent: true,
      status: 'LIVE',
      visibility: 'PUBLIC',
      project: { deletedAt: null, adminStatus: 'ACTIVE' },
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: {
      domain: true,
      publishedAt: true,
      project: {
        select: {
          id: true,
          name: true,
          slug: true,
          workspace: { select: { slug: true } },
          artifacts: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { slug: true, previewImageUrl: true },
          },
        },
      },
    },
  });

  return deployments.map((deployment) => ({
    projectId: deployment.project.id,
    name: deployment.project.name,
    slug: deployment.project.slug,
    workspaceSlug: deployment.project.workspace.slug,
    publishedUrl: deployment.domain,
    mainArtifactSlug: deployment.project.artifacts[0]?.slug ?? null,
    previewImageUrl: deployment.project.artifacts[0]?.previewImageUrl ?? null,
    publishedAt: deployment.publishedAt?.toISOString() ?? null,
  }));
}

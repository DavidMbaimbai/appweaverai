import { prisma } from '../prisma';

export type PublicProjectSummary = {
  projectId: string;
  name: string;
  description: string | null;
  slug: string;
  workspaceSlug: string;
  publishedUrl: string;
  mainArtifactSlug: string | null;
  previewImageUrl: string | null;
  publishedAt: string | null;
  category: string | null;
  authorName: string | null;
  authorImage: string | null;
  viewCount: number;
  remixCount: number;
};

export type ExploreSort = 'recent' | 'popular' | 'remixed';

/**
 * Lists the most recently published PUBLIC projects across the whole app,
 * for the "Explore" gallery where any signed-in user can browse and remix
 * ideas (Replit/Lovable-style community discovery gallery).
 */
export async function listPublicProjects(
  options: {
    limit?: number;
    search?: string;
    sort?: ExploreSort;
    category?: string;
  } = {},
): Promise<PublicProjectSummary[]> {
  const limit = options.limit ?? 24;
  const search = options.search?.trim();
  const sort = options.sort ?? 'recent';

  const orderBy =
    sort === 'popular'
      ? { pageViews: { _count: 'desc' as const } }
      : sort === 'remixed'
        ? { remixes: { _count: 'desc' as const } }
        : { updatedAt: 'desc' as const };

  // "Recent" is measured by when a project's current deployment was
  // published, which isn't a field Prisma can order a to-many relation by
  // directly (only relation _count is supported), so for that sort we
  // over-fetch a larger, capped batch and re-sort/slice in memory below.
  const overFetch = sort === 'recent' ? Math.min(limit * 4, 300) : limit;

  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      adminStatus: 'ACTIVE',
      deployments: {
        some: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
      },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(options.category
        ? { artifacts: { some: { type: options.category as never } } }
        : {}),
    },
    orderBy,
    take: overFetch,
    select: {
      id: true,
      name: true,
      description: true,
      slug: true,
      workspace: { select: { slug: true } },
      createdBy: { select: { name: true, image: true } },
      artifacts: {
        orderBy: { sortOrder: 'asc' },
        take: 1,
        select: { slug: true, previewImageUrl: true, type: true },
      },
      deployments: {
        where: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
        take: 1,
        select: { domain: true, publishedAt: true },
      },
      _count: { select: { pageViews: true, remixes: true } },
    },
  });

  const results = projects
    .filter((project) => project.deployments.length > 0)
    .map((project) => ({
      projectId: project.id,
      name: project.name,
      description: project.description,
      slug: project.slug,
      workspaceSlug: project.workspace.slug,
      publishedUrl: project.deployments[0].domain,
      mainArtifactSlug: project.artifacts[0]?.slug ?? null,
      previewImageUrl: project.artifacts[0]?.previewImageUrl ?? null,
      publishedAt: project.deployments[0].publishedAt?.toISOString() ?? null,
      category: project.artifacts[0]?.type ?? null,
      authorName: project.createdBy?.name ?? null,
      authorImage: project.createdBy?.image ?? null,
      viewCount: project._count.pageViews,
      remixCount: project._count.remixes,
    }));

  if (sort === 'recent') {
    results.sort(
      (a, b) =>
        new Date(b.publishedAt ?? 0).getTime() -
        new Date(a.publishedAt ?? 0).getTime(),
    );
  }

  return results.slice(0, limit);
}

/** Distinct artifact categories currently published, for the gallery filter bar. */
export async function listExploreCategories(): Promise<string[]> {
  const rows = await prisma.artifact.findMany({
    where: {
      project: {
        deletedAt: null,
        adminStatus: 'ACTIVE',
        deployments: {
          some: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
        },
      },
    },
    distinct: ['type'],
    select: { type: true },
  });

  return rows.map((row) => row.type);
}

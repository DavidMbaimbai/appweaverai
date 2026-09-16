import { prisma } from '@/lib/prisma';

export type ProjectAnalyticsSummary = {
  totalViews: number;
  uniqueVisitors: number;
  viewsLast7Days: { date: string; count: number }[];
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Owner-facing analytics for a published project, aggregated from
 * ProjectPageView rows recorded on every anonymous visit to the project's
 * public /p/... URL (see lib/analytics/record-page-view.ts). Powers the
 * "Analytics" panel in the editor topbar — the public-app view/visitor
 * insight most AI app-builder competitors don't expose at all.
 */
export async function getProjectAnalyticsSummary(
  projectId: string,
): Promise<ProjectAnalyticsSummary> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS);

  const [totalViews, visitorGroups, dailyRows, pathGroups, referrerGroups] =
    await Promise.all([
      prisma.projectPageView.count({ where: { projectId } }),
      prisma.projectPageView.groupBy({
        by: ['visitorId'],
        where: { projectId },
      }),
      prisma.projectPageView.findMany({
        where: { projectId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.projectPageView.groupBy({
        by: ['path'],
        where: { projectId },
        _count: { path: true },
        orderBy: { _count: { path: 'desc' } },
        take: 5,
      }),
      prisma.projectPageView.groupBy({
        by: ['referrer'],
        where: { projectId, NOT: { referrer: null } },
        _count: { referrer: true },
        orderBy: { _count: { referrer: 'desc' } },
        take: 5,
      }),
    ]);

  const buckets = new Map<string, number>();
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    buckets.set(date, 0);
  }
  for (const row of dailyRows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    if (buckets.has(date)) {
      buckets.set(date, (buckets.get(date) ?? 0) + 1);
    }
  }

  return {
    totalViews,
    uniqueVisitors: visitorGroups.length,
    viewsLast7Days: Array.from(buckets.entries()).map(([date, count]) => ({
      date,
      count,
    })),
    topPaths: pathGroups.map((row) => ({
      path: row.path,
      count: row._count.path,
    })),
    topReferrers: referrerGroups
      .filter((row) => row.referrer)
      .map((row) => ({
        referrer: row.referrer as string,
        count: row._count.referrer,
      })),
  };
}

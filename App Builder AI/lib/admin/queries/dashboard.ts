import { prisma } from '@/lib/prisma';
import { fetchProPlanInfo } from '@/lib/stripe';

export type DateRange = { from: Date; to: Date };

export function rangeLengthMs(range: DateRange) {
  return range.to.getTime() - range.from.getTime();
}

/** Previous period of equal length, used for period-over-period comparisons. */
export function previousRange(range: DateRange): DateRange {
  const length = rangeLengthMs(range);
  return {
    from: new Date(range.from.getTime() - length),
    to: new Date(range.from.getTime()),
  };
}

export function resolveRangeFromParam(param?: string): DateRange {
  const to = new Date();
  const days =
    param === '7d'
      ? 7
      : param === '90d'
        ? 90
        : param === '30d'
          ? 30
          : param === 'today'
            ? 1
            : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Consolidated dashboard KPIs (ADM-010). Metrics are intentionally
 * deterministic and documented inline so they can be reconciled.
 */
export async function getDashboardKpis(range: DateRange) {
  const prev = previousRange(range);

  const [
    totalUsers,
    newUsers,
    newUsersPrev,
    payingUsers,
    activeUsers,
    activeUsersPrev,
    totalProjects,
    newProjects,
    aiUsageAgg,
    aiUsageAggPrev,
    proPlan,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: { createdAt: { gte: range.from, lte: range.to } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: prev.from, lte: prev.to } },
    }),
    prisma.user.count({ where: { subscriptionStatus: 'active' } }),
    prisma.session
      .findMany({
        where: { updatedAt: { gte: range.from, lte: range.to } },
        select: { userId: true },
        distinct: ['userId'],
      })
      .then((rows) => rows.length),
    prisma.session
      .findMany({
        where: { updatedAt: { gte: prev.from, lte: prev.to } },
        select: { userId: true },
        distinct: ['userId'],
      })
      .then((rows) => rows.length),
    prisma.project.count({ where: { deletedAt: null } }),
    prisma.project.count({
      where: { createdAt: { gte: range.from, lte: range.to }, deletedAt: null },
    }),
    prisma.aiUsageEvent.aggregate({
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostCents: true },
    }),
    prisma.aiUsageEvent.aggregate({
      where: { createdAt: { gte: prev.from, lte: prev.to } },
      _count: { _all: true },
      _sum: { estimatedCostCents: true },
    }),
    fetchProPlanInfo(),
  ]);

  const mrrCents = proPlan.displayMonthlyPrice
    ? Math.round(proPlan.displayMonthlyPrice * 100 * payingUsers)
    : null;

  return {
    range,
    users: {
      total: totalUsers,
      new: newUsers,
      newChangePct: percentChange(newUsers, newUsersPrev),
      paying: payingUsers,
    },
    engagement: {
      active: activeUsers,
      activeChangePct: percentChange(activeUsers, activeUsersPrev),
    },
    revenue: {
      mrrCents,
      arrCents: mrrCents != null ? mrrCents * 12 : null,
      currency: 'USD',
    },
    projects: {
      total: totalProjects,
      new: newProjects,
    },
    aiUsage: {
      requests: aiUsageAgg._count._all,
      tokens:
        (aiUsageAgg._sum.inputTokens ?? 0) +
        (aiUsageAgg._sum.outputTokens ?? 0),
      costCents: aiUsageAgg._sum.estimatedCostCents ?? 0,
      costChangePct: percentChange(
        aiUsageAgg._sum.estimatedCostCents ?? 0,
        aiUsageAggPrev._sum.estimatedCostCents ?? 0,
      ),
    },
  };
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Trend series for dashboard charts (ADM-013), grouped by day. */
export async function getDashboardTrends(range: DateRange) {
  const [users, projects, aiUsage] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true },
    }),
    prisma.project.findMany({
      where: { createdAt: { gte: range.from, lte: range.to }, deletedAt: null },
      select: { createdAt: true },
    }),
    prisma.aiUsageEvent.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true, estimatedCostCents: true },
    }),
  ]);

  return {
    users: bucketByDay(users.map((u) => u.createdAt)),
    projects: bucketByDay(projects.map((p) => p.createdAt)),
    aiCost: bucketByDay(
      aiUsage.map((e) => e.createdAt),
      aiUsage.map((e) => e.estimatedCostCents),
    ),
  };
}

function bucketByDay(dates: Date[], weights?: number[]) {
  const buckets = new Map<string, number>();
  dates.forEach((date, i) => {
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + (weights ? weights[i] : 1));
  });
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

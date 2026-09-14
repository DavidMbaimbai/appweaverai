import { prisma } from '@/lib/prisma';
import type { DateRange } from './dashboard';

/**
 * Platform analytics beyond the top-level Dashboard/AI Usage pages
 * (EPIC 5 — Platform Analytics & Trends). Covers active-user metrics
 * (ADM-041), registration/growth trends (ADM-042), feature adoption via AI
 * model usage (ADM-043), and peak usage hours (ADM-045), all computed
 * directly from existing tables (no separate event-tracking pipeline yet).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Distinct active users (by session activity) over the last 1/7/30 days. */
export async function getActiveUserCounts() {
  const now = new Date();
  const [dau, wau, mau] = await Promise.all([
    countDistinctActiveUsers(new Date(now.getTime() - 1 * DAY_MS)),
    countDistinctActiveUsers(new Date(now.getTime() - 7 * DAY_MS)),
    countDistinctActiveUsers(new Date(now.getTime() - 30 * DAY_MS)),
  ]);

  return { dau, wau, mau };
}

async function countDistinctActiveUsers(since: Date) {
  const rows = await prisma.session.findMany({
    where: { updatedAt: { gte: since } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.length;
}

/** Daily signups and cumulative registered users over the selected range. */
export async function getRegistrationTrend(range: DateRange) {
  const [usersInRange, totalBefore] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.count({ where: { createdAt: { lt: range.from } } }),
  ]);

  const daily = bucketByDay(usersInRange.map((u) => u.createdAt));

  let running = totalBefore;
  const cumulative = daily.map((point) => {
    running += point.value;
    return { date: point.date, value: running };
  });

  const totalNew = usersInRange.length;
  const days = Math.max(
    1,
    Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS),
  );

  return {
    daily,
    cumulative,
    totalNew,
    avgPerDay: Math.round((totalNew / days) * 10) / 10,
  };
}

function bucketByDay(dates: Date[]) {
  const buckets = new Map<string, number>();
  dates.forEach((date) => {
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  });
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/** Breakdown of users by subscription plan. */
export async function getPlanDistribution() {
  const rows = await prisma.user.groupBy({
    by: ['subscriptionPlan'],
    _count: { _all: true },
  });

  const total = rows.reduce((sum, row) => sum + row._count._all, 0);

  return rows
    .map((row) => ({
      plan: row.subscriptionPlan,
      count: row._count._all,
      pct: total > 0 ? Math.round((row._count._all / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Feature adoption proxy (ADM-043): usage of AI providers/models, ranked by
 * unique users and total requests, since there is no separate feature
 * event-tracking pipeline yet.
 */
export async function getAiFeatureAdoption(range: DateRange) {
  const events = await prisma.aiUsageEvent.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { provider: true, model: true, userId: true },
  });

  const stats = new Map<
    string,
    { provider: string; model: string; requests: number; users: Set<string> }
  >();

  for (const event of events) {
    const key = `${event.provider}::${event.model}`;
    const entry = stats.get(key) ?? {
      provider: event.provider,
      model: event.model,
      requests: 0,
      users: new Set<string>(),
    };
    entry.requests += 1;
    if (event.userId) entry.users.add(event.userId);
    stats.set(key, entry);
  }

  return Array.from(stats.values())
    .map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      requests: entry.requests,
      uniqueUsers: entry.users.size,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 8);
}

/** Peak usage hours (ADM-045): request volume bucketed by hour of day (UTC). */
export async function getPeakUsageHours(range: DateRange) {
  const events = await prisma.aiUsageEvent.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true },
  });

  const buckets = new Array(24).fill(0);
  for (const event of events) {
    buckets[event.createdAt.getUTCHours()] += 1;
  }

  const peakHour = buckets.reduce(
    (best, value, hour) => (value > buckets[best] ? hour : best),
    0,
  );

  return {
    hourly: buckets.map((value, hour) => ({ hour, value })),
    peakHour,
    peakRequests: buckets[peakHour] ?? 0,
  };
}

import { sendAlert } from '@/lib/alerts';
import { prisma } from '@/lib/prisma';

import { assembleProject } from './project';
import { loadJourneys } from './platform';
import { dayKey, DAY_MS, detectAnomaly, startOfUtcDay, UNTRACKED, type Journey } from './stats';

export const PLATFORM_SCOPE = 'PLATFORM';
export const PROJECT_SCOPE = 'PROJECT';

export type RollupRow = { scopeType: string; scopeId: string; day: string; dimension: string; dimKey: string; metric: string; value: number };

const LOOKBACK_DAYS = 120;
const BATCH = 100;

/** Idempotent: the natural key is unique and each row is upserted, so re-running a day never duplicates or drifts. */
export async function upsertRollups(rows: RollupRow[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.$transaction(
      rows.slice(i, i + BATCH).map((r) => {
        const day = new Date(`${r.day}T00:00:00Z`);
        return prisma.growthRollup.upsert({
          where: { scopeType_scopeId_day_dimension_dimKey_metric: { scopeType: r.scopeType, scopeId: r.scopeId, day, dimension: r.dimension, dimKey: r.dimKey, metric: r.metric } },
          create: { scopeType: r.scopeType, scopeId: r.scopeId, day, dimension: r.dimension, dimKey: r.dimKey, metric: r.metric, value: r.value },
          update: { value: r.value },
        });
      }),
    );
  }
  return rows.length;
}

export const lastDays = (days: number, now = new Date()) => {
  const end = startOfUtcDay(now);
  return Array.from({ length: days }, (_, i) => dayKey(new Date(end.getTime() - (days - i) * DAY_MS)));
};

/** Pure: turns journeys + visit/activity counts into rollup rows for the given complete days. */
export function platformRollupRows(input: {
  days: string[];
  journeys: Journey[];
  visits: { day: string; channel: string; visits: number; visitors: number }[];
  activeUsers: Map<string, number>;
}): RollupRow[] {
  const inRange = new Set(input.days);
  const rows = new Map<string, RollupRow>();
  const bump = (day: string, dimension: string, dimKey: string, metric: string, by: number) => {
    if (!inRange.has(day)) return;
    const key = `${day}|${dimension}|${dimKey}|${metric}`;
    const cur = rows.get(key);
    if (cur) cur.value += by;
    else rows.set(key, { scopeType: PLATFORM_SCOPE, scopeId: PLATFORM_SCOPE, day, dimension, dimKey, metric, value: by });
  };
  for (const day of input.days) {
    for (const metric of ['visits', 'visitors', 'signups', 'activations', 'paid', 'active_users']) bump(day, 'total', '', metric, 0);
  }
  for (const v of input.visits) {
    bump(v.day, 'total', '', 'visits', v.visits);
    bump(v.day, 'total', '', 'visitors', v.visitors);
    bump(v.day, 'channel', v.channel, 'visits', v.visits);
  }
  for (const j of input.journeys) {
    const channel = j.tracked ? j.firstChannel : UNTRACKED;
    const events: [Date | null, string][] = [[j.signedUpAt, 'signups'], [j.activatedAt, 'activations'], [j.paidAt, 'paid']];
    for (const [at, metric] of events) {
      if (!at) continue;
      bump(dayKey(at), 'total', '', metric, 1);
      bump(dayKey(at), 'channel', channel, metric, 1);
    }
  }
  for (const [day, n] of input.activeUsers) bump(day, 'total', '', 'active_users', n);
  return [...rows.values()];
}

export async function rollupPlatform(days: string[], now = new Date()) {
  if (!days.length) return { rows: 0 };
  const start = new Date(`${days[0]}T00:00:00Z`);
  const end = new Date(new Date(`${days[days.length - 1]}T00:00:00Z`).getTime() + DAY_MS);
  const journeys = await loadJourneys(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), end);
  const [visits, active] = await Promise.all([
    prisma.$queryRaw<{ day: string; channel: string; visits: bigint; visitors: bigint }[]>`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, channel, COUNT(*)::bigint AS visits, COUNT(DISTINCT visitor_id)::bigint AS visitors FROM growth_visits WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: string; n: bigint }[]>`SELECT day, COUNT(DISTINCT user_id)::bigint AS n FROM (SELECT user_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM ai_usage_events WHERE user_id IS NOT NULL AND created_at >= ${start} AND created_at < ${end} UNION ALL SELECT user_id, day FROM growth_feature_events WHERE created_at >= ${start} AND created_at < ${end}) t GROUP BY day`,
  ]);
  const rows = platformRollupRows({
    days,
    journeys,
    visits: visits.map((v) => ({ day: v.day, channel: v.channel, visits: Number(v.visits), visitors: Number(v.visitors) })),
    activeUsers: new Map(active.map((a) => [a.day, Number(a.n)])),
  });
  return { rows: await upsertRollups(rows) };
}

type ProjectView = { project_id: string; day: string; source: string | null; medium: string | null; host: string | null; views: bigint; visitors: bigint };
type ProjectLead = { project_id: string; day: string; utm: unknown; status: string; id: string };

export async function rollupProjects(days: string[]) {
  if (!days.length) return { rows: 0, projects: 0 };
  const start = new Date(`${days[0]}T00:00:00Z`);
  const end = new Date(new Date(`${days[days.length - 1]}T00:00:00Z`).getTime() + DAY_MS);
  const [views, leads, bookings] = await Promise.all([
    prisma.$queryRaw<ProjectView[]>`SELECT project_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, NULLIF(utm->>'source','') AS source, NULLIF(utm->>'medium','') AS medium, substring(referrer from '^https?://([^/:?#]+)') AS host, COUNT(*)::bigint AS views, COUNT(DISTINCT visitor_id)::bigint AS visitors FROM project_page_views WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1, 2, 3, 4, 5`,
    prisma.$queryRaw<ProjectLead[]>`SELECT project_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, utm, status, id FROM leads WHERE created_at >= ${start} AND created_at < ${end}`,
    prisma.$queryRaw<{ project_id: string; day: string; utm: unknown }[]>`SELECT s.project_id AS project_id, to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, l.utm AS utm FROM lead_bookings b JOIN lead_availability_slots s ON s.id = b.slot_id JOIN leads l ON l.id = b.lead_id WHERE b.created_at >= ${start} AND b.created_at < ${end}`,
  ]);
  const projectIds = new Set([...views.map((v) => v.project_id), ...leads.map((l) => l.project_id), ...bookings.map((b) => b.project_id)]);
  const rows: RollupRow[] = [];
  for (const projectId of projectIds) {
    for (const day of days) {
      const from = new Date(`${day}T00:00:00Z`);
      const snap = assembleProject({
        from,
        to: new Date(from.getTime() + DAY_MS),
        viewGroups: views.filter((v) => v.project_id === projectId && v.day === day).map((v) => ({ source: v.source ?? undefined, medium: v.medium ?? undefined, host: v.host ?? undefined, views: Number(v.views), visitors: Number(v.visitors) })),
        dailyViews: [],
        leads: leads.filter((l) => l.project_id === projectId && l.day === day).map((l) => ({ id: l.id, utm: l.utm, status: l.status, createdAt: from })),
        bookingLeadUtms: bookings.filter((b) => b.project_id === projectId && b.day === day).map((b) => b.utm),
        visitorsTotal: views.filter((v) => v.project_id === projectId && v.day === day).reduce((s, v) => s + Number(v.visitors), 0),
      });
      const base = { scopeType: PROJECT_SCOPE, scopeId: projectId, day };
      for (const [metric, value] of Object.entries({ views: snap.totals.views, visitors: snap.totals.visitors, leads: snap.totals.leads, won: snap.totals.won, bookings: snap.totals.bookings })) {
        rows.push({ ...base, dimension: 'total', dimKey: '', metric, value });
      }
      for (const c of snap.channels) {
        for (const [metric, value] of Object.entries({ views: c.views, leads: c.leads, won: c.won, bookings: c.bookings })) {
          if (value > 0) rows.push({ ...base, dimension: 'channel', dimKey: c.channel, metric, value });
        }
      }
    }
  }
  return { rows: await upsertRollups(rows), projects: projectIds.size };
}

export async function seriesFor(scopeType: string, scopeId: string, metric: string, days: string[], dimension = 'total', dimKey = '') {
  const data = await prisma.growthRollup.findMany({
    where: { scopeType, scopeId, dimension, dimKey, metric, day: { gte: new Date(`${days[0]}T00:00:00Z`), lte: new Date(`${days[days.length - 1]}T00:00:00Z`) } },
    select: { day: true, value: true },
  });
  const byDay = new Map(data.map((d) => [dayKey(d.day), d.value]));
  return days.map((day) => byDay.get(day) ?? 0);
}

const ALERT_METRICS: Record<string, string[]> = { [PLATFORM_SCOPE]: ['visits', 'signups', 'activations'], [PROJECT_SCOPE]: ['views', 'leads'] };

/** Detects drops/spikes on the latest complete day. One alert per scope+metric+day; only newly created alerts notify. */
export async function detectAndStoreAlerts(scopeType: string, scopeId: string, days: string[]) {
  const created: { metric: string; message: string }[] = [];
  const day = days[days.length - 1];
  for (const metric of ALERT_METRICS[scopeType] ?? []) {
    const series = await seriesFor(scopeType, scopeId, metric, days);
    const result = detectAnomaly(series);
    if (result.status !== 'anomaly') continue;
    const label = metric.replace('_', ' ');
    const message = `${label} ${result.kind === 'DROP' ? 'dropped' : 'spiked'} on ${day}: ${result.observed} vs a typical ${Math.round(result.expected * 10) / 10}.`;
    const where = { scopeType_scopeId_metric_day: { scopeType, scopeId, metric, day: new Date(`${day}T00:00:00Z`) } };
    const existing = await prisma.growthAlert.findUnique({ where });
    if (existing) {
      await prisma.growthAlert.update({ where, data: { observed: result.observed, expected: result.expected, message } });
      continue;
    }
    await prisma.growthAlert.create({ data: { scopeType, scopeId, metric, day: new Date(`${day}T00:00:00Z`), kind: result.kind, observed: result.observed, expected: result.expected, message } });
    created.push({ metric, message });
    if (scopeType === PLATFORM_SCOPE) {
      await sendAlert(`Growth anomaly: ${label} ${result.kind.toLowerCase()}`, message);
      await prisma.growthAlert.update({ where, data: { notifiedAt: new Date() } });
    }
  }
  return created;
}

export async function runNightly(opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const window = lastDays(Math.min(Math.max(opts.days ?? 3, 1), 90), now);
  const platform = await rollupPlatform(window, now);
  const projects = await rollupProjects(window);
  const trendDays = lastDays(28, now);
  const alerts = await detectAndStoreAlerts(PLATFORM_SCOPE, PLATFORM_SCOPE, trendDays);
  const active = await prisma.growthRollup.findMany({
    where: { scopeType: PROJECT_SCOPE, dimension: 'total', metric: 'views', day: { gte: new Date(`${trendDays[0]}T00:00:00Z`) }, value: { gt: 0 } },
    select: { scopeId: true },
    distinct: ['scopeId'],
    take: 2000,
  });
  let projectAlerts = 0;
  for (const { scopeId } of active) projectAlerts += (await detectAndStoreAlerts(PROJECT_SCOPE, scopeId, trendDays)).length;
  return { days: window, platformRows: platform.rows, projectRows: projects.rows, projects: projects.projects, platformAlerts: alerts.length, projectAlerts };
}

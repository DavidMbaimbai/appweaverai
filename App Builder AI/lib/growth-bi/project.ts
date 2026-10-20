import { prisma } from '@/lib/prisma';

import { classifyChannel, referrerHostOf } from './attribution';
import { dayKey, DAY_MS } from './stats';
import type { CatalogMetric } from './recommend';
import { metricId } from './recommend';

const UNTAGGED = 'untagged';

type UtmShape = { source?: unknown; medium?: unknown; campaign?: unknown } | null;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase().slice(0, 80) : undefined);

/** Channel of a lead from its captured UTM values; leads without UTM are explicitly "untagged", never guessed. */
export function leadChannel(utm: unknown): string {
  const u = (utm ?? null) as UtmShape;
  const source = str(u?.source);
  return source ? classifyChannel({ source, medium: str(u?.medium) }) : UNTAGGED;
}

export type ProjectChannelRow = {
  channel: string;
  views: number;
  visitors: number;
  leads: number;
  won: number;
  bookings: number;
  viewToLead: number | null;
};

export type ProjectSnapshot = {
  from: string;
  to: string;
  totals: { views: number; visitors: number; leads: number; won: number; bookings: number; viewToLead: number | null };
  channels: ProjectChannelRow[];
  campaigns: { campaign: string; leads: number; won: number }[];
  trend: { day: string; views: number; leads: number }[];
  untaggedLeadPct: number | null;
  untaggedViewPct: number | null;
  retention: { status: 'not_available'; reason: string };
};

export const PROJECT_RETENTION_NOTE =
  'Retention is not available: visitor ids rotate daily by design so returning visitors cannot be recognised. Lead-to-won conversion is shown instead.';

export function emptyChannel(channel: string): ProjectChannelRow {
  return { channel, views: 0, visitors: 0, leads: 0, won: 0, bookings: 0, viewToLead: null };
}

/** Pure merge of raw per-source groups into channel rows. Exported for tests. */
export function assembleProject(input: {
  from: Date;
  to: Date;
  viewGroups: { source?: string; medium?: string; host?: string; views: number; visitors: number }[];
  dailyViews: { day: string; views: number }[];
  leads: { id: string; utm: unknown; status: string; createdAt: Date }[];
  bookingLeadUtms: unknown[];
  visitorsTotal: number;
}): ProjectSnapshot {
  const rows = new Map<string, ProjectChannelRow>();
  const get = (channel: string) => rows.get(channel) ?? rows.set(channel, emptyChannel(channel)).get(channel)!;
  let untaggedViews = 0;
  let views = 0;
  for (const g of input.viewGroups) {
    const channel = classifyChannel({ source: g.source, medium: g.medium, referrerHost: g.host });
    const r = get(channel);
    r.views += g.views;
    r.visitors += g.visitors;
    views += g.views;
    if (!g.source) untaggedViews += g.views;
  }
  const campaigns = new Map<string, { leads: number; won: number }>();
  for (const l of input.leads) {
    const r = get(leadChannel(l.utm));
    r.leads += 1;
    if (l.status === 'WON') r.won += 1;
    const campaign = str((l.utm as UtmShape)?.campaign);
    if (campaign) {
      const c = campaigns.get(campaign) ?? { leads: 0, won: 0 };
      campaigns.set(campaign, { leads: c.leads + 1, won: c.won + (l.status === 'WON' ? 1 : 0) });
    }
  }
  for (const utm of input.bookingLeadUtms) get(leadChannel(utm)).bookings += 1;

  const channels = [...rows.values()]
    .map((r) => ({ ...r, viewToLead: r.views > 0 ? r.leads / r.views : null }))
    .sort((a, b) => b.leads - a.leads || b.views - a.views || a.channel.localeCompare(b.channel));
  const leadsN = input.leads.length;
  const won = input.leads.filter((l) => l.status === 'WON').length;

  const leadsByDay = new Map<string, number>();
  for (const l of input.leads) leadsByDay.set(dayKey(l.createdAt), (leadsByDay.get(dayKey(l.createdAt)) ?? 0) + 1);
  const viewsByDay = new Map(input.dailyViews.map((d) => [d.day, d.views]));
  const trend: ProjectSnapshot['trend'] = [];
  for (let t = Date.parse(`${dayKey(input.from)}T00:00:00Z`); t < input.to.getTime(); t += DAY_MS) {
    const day = dayKey(new Date(t));
    trend.push({ day, views: viewsByDay.get(day) ?? 0, leads: leadsByDay.get(day) ?? 0 });
  }

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    totals: { views, visitors: input.visitorsTotal, leads: leadsN, won, bookings: input.bookingLeadUtms.length, viewToLead: views > 0 ? leadsN / views : null },
    channels,
    campaigns: [...campaigns.entries()].map(([campaign, c]) => ({ campaign, ...c })).sort((a, b) => b.leads - a.leads || a.campaign.localeCompare(b.campaign)).slice(0, 10),
    trend,
    untaggedLeadPct: leadsN ? input.leads.filter((l) => leadChannel(l.utm) === UNTAGGED).length / leadsN : null,
    untaggedViewPct: views ? untaggedViews / views : null,
    retention: { status: 'not_available', reason: PROJECT_RETENTION_NOTE },
  };
}

type ViewGroup = { source: string | null; medium: string | null; host: string | null; views: bigint; visitors: bigint };

/** Everything is scoped by projectId; callers must have verified access to that project first. */
export async function collectProject(projectId: string, from: Date, to: Date): Promise<ProjectSnapshot> {
  const [groups, daily, uniq, leads, bookings] = await Promise.all([
    prisma.$queryRaw<ViewGroup[]>`SELECT NULLIF(utm->>'source','') AS source, NULLIF(utm->>'medium','') AS medium, substring(referrer from '^https?://([^/:?#]+)') AS host, COUNT(*)::bigint AS views, COUNT(DISTINCT visitor_id)::bigint AS visitors FROM project_page_views WHERE project_id = ${projectId} AND created_at >= ${from} AND created_at < ${to} GROUP BY 1, 2, 3`,
    prisma.$queryRaw<{ day: string; views: bigint }[]>`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS views FROM project_page_views WHERE project_id = ${projectId} AND created_at >= ${from} AND created_at < ${to} GROUP BY 1`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM (SELECT DISTINCT visitor_id, date_trunc('day', created_at) FROM project_page_views WHERE project_id = ${projectId} AND created_at >= ${from} AND created_at < ${to}) t`,
    prisma.lead.findMany({ where: { projectId, createdAt: { gte: from, lt: to } }, select: { id: true, utm: true, status: true, createdAt: true }, take: 5000 }),
    prisma.leadBooking.findMany({ where: { slot: { projectId }, createdAt: { gte: from, lt: to } }, select: { lead: { select: { utm: true } } }, take: 5000 }),
  ]);
  return assembleProject({
    from,
    to,
    viewGroups: groups.map((g) => ({
      source: str(g.source),
      medium: str(g.medium),
      host: referrerHostOf(g.host ? `https://${g.host}` : null),
      views: Number(g.views),
      visitors: Number(g.visitors),
    })),
    dailyViews: daily.map((d) => ({ day: d.day, views: Number(d.views) })),
    leads,
    bookingLeadUtms: bookings.map((b) => b.lead.utm),
    visitorsTotal: Number(uniq[0]?.n ?? 0),
  });
}

export function projectCatalog(s: ProjectSnapshot): CatalogMetric[] {
  const period = `${dayKey(new Date(s.from))}..${dayKey(new Date(s.to))}`;
  const m: CatalogMetric[] = [];
  const add = (id: string, label: string, value: number | null, unit: CatalogMetric['unit'] = 'count') => {
    if (value != null && Number.isFinite(value)) m.push({ id, label, value, unit, period });
  };
  add('project.views', 'Page views', s.totals.views);
  add('project.visitors', 'Unique visitors (per day, summed)', s.totals.visitors);
  add('project.leads', 'New leads', s.totals.leads);
  add('project.won', 'Leads won', s.totals.won);
  add('project.bookings', 'Demo bookings', s.totals.bookings);
  add('project.view_to_lead', 'Page view to lead rate', s.totals.viewToLead, 'percent');
  add('project.untagged_lead_pct', 'Leads without UTM tags', s.untaggedLeadPct, 'percent');
  add('project.untagged_view_pct', 'Page views without UTM tags', s.untaggedViewPct, 'percent');
  for (const c of s.channels.slice(0, 8)) {
    add(metricId('pchannel', 'views', c.channel), `Page views from ${c.channel}`, c.views);
    add(metricId('pchannel', 'leads', c.channel), `Leads from ${c.channel}`, c.leads);
    add(metricId('pchannel', 'won', c.channel), `Leads won from ${c.channel}`, c.won);
    add(metricId('pchannel', 'view_to_lead', c.channel), `View to lead rate for ${c.channel}`, c.viewToLead, 'percent');
  }
  return m;
}

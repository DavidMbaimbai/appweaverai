import { cleanUtm } from '@/lib/leads/logic';
import { prisma } from '@/lib/prisma';

export const METRIC_KEYS = [
  'pageViews',
  'uniqueVisitors',
  'leads',
  'leadsWon',
  'leadToWonPercent',
  'demoBookings',
  'postsPublished',
  'reviews',
  'averageRating',
  'supportTickets',
  'videoReleases',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type Metric = {
  key: MetricKey;
  label: string;
  value: number | null;
  /** Always 'measured' when a value exists; 'not_available' when no data source is connected. Never an estimate. */
  status: 'measured' | 'not_available';
  unit: 'count' | 'rating' | 'percent';
  source: string;
  note?: string;
};

/** null/undefined means "no connected source"; 0 is a real measured zero. */
export type RawMetrics = Partial<Record<MetricKey, number | null>>;

const META: Record<MetricKey, { label: string; unit: Metric['unit']; source: string; note?: string; missing: string }> = {
  pageViews: { label: 'Page views', unit: 'count', source: 'Published app page-view log', missing: 'Publish your app to start recording page views.' },
  uniqueVisitors: {
    label: 'Unique visitors (per day, summed)',
    unit: 'count',
    source: 'Published app page-view log',
    note: 'Anonymous daily-rotating IDs: a returning visitor on another day counts again.',
    missing: 'Publish your app to start recording visitors.',
  },
  leads: { label: 'New leads', unit: 'count', source: 'Leads CRM', missing: 'No leads captured yet. Add the lead widget or a form.' },
  leadsWon: { label: 'Leads won', unit: 'count', source: 'Leads CRM', missing: 'No leads captured yet.' },
  leadToWonPercent: { label: 'Lead → won rate', unit: 'percent', source: 'Leads CRM', note: 'Won ÷ new leads in the period.', missing: 'Needs at least one new lead in the period.' },
  demoBookings: { label: 'Demo bookings', unit: 'count', source: 'Demo booking page', missing: 'No availability slots defined yet.' },
  postsPublished: { label: 'Marketing posts published', unit: 'count', source: 'Marketing campaigns', missing: 'No marketing campaigns created yet.' },
  reviews: { label: 'Reviews received', unit: 'count', source: 'Reviews widget', missing: 'No reviews received yet.' },
  averageRating: { label: 'Average rating', unit: 'rating', source: 'Reviews widget', missing: 'No reviews in this period.' },
  supportTickets: { label: 'Support tickets', unit: 'count', source: 'Support widget', missing: 'Reviews & support widget not set up.' },
  videoReleases: {
    label: 'Video releases published',
    unit: 'count',
    source: 'Video release scheduler',
    note: 'Counts all releases on your account, not only this project.',
    missing: 'No video releases scheduled on your account.',
  },
};

export const metricLabel = (key: string) => META[key as MetricKey]?.label ?? key;

/** Single place that turns "source connected?" + a count into a value, so zero and not-available never blur. */
export const gate = (available: boolean, value: number | null | undefined): number | null =>
  available && typeof value === 'number' && Number.isFinite(value) ? value : null;

export function buildMetrics(raw: RawMetrics): Metric[] {
  return METRIC_KEYS.map((key) => {
    const value = raw[key];
    const meta = META[key];
    const measured = typeof value === 'number' && Number.isFinite(value);
    return {
      key,
      label: meta.label,
      value: measured ? value : null,
      status: measured ? 'measured' : 'not_available',
      unit: meta.unit,
      source: meta.source,
      note: measured ? meta.note : meta.missing,
    };
  });
}

export type Breakdown = { label: string; count: number }[];

export function breakdownLeads(leads: { source: string; utm: unknown }[]) {
  const bySource = new Map<string, number>();
  const byUtm = new Map<string, number>();
  for (const l of leads) {
    bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
    const utm = cleanUtm(l.utm);
    if (utm) {
      const label = [utm.source, utm.medium, utm.campaign].filter(Boolean).join(' / ');
      byUtm.set(label, (byUtm.get(label) ?? 0) + 1);
    }
  }
  const toList = (m: Map<string, number>): Breakdown =>
    [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 10);
  return { bySource: toList(bySource), byUtm: toList(byUtm), untracked: leads.filter((l) => !cleanUtm(l.utm)).length };
}

export type GrowthSnapshot = {
  from: string;
  to: string;
  metrics: Metric[];
  leadsBySource: Breakdown;
  leadsByUtm: Breakdown;
  leadsWithoutUtm: number | null;
};

export async function collectGrowth(projectId: string, from: Date, to: Date): Promise<GrowthSnapshot> {
  const range = { gte: from, lt: to };
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { createdById: true } });

  const [published, leadsEver, slotsEver, campaignsEver, reviewsEver, settings, videoEver] = await Promise.all([
    prisma.deployment.count({ where: { projectId } }),
    prisma.lead.count({ where: { projectId } }),
    prisma.leadAvailabilitySlot.count({ where: { projectId } }),
    prisma.projectCampaign.count({ where: { projectId } }),
    prisma.projectReview.count({ where: { projectId } }),
    prisma.projectReviewSettings.findUnique({ where: { projectId }, select: { projectId: true } }),
    project ? prisma.videoRelease.count({ where: { userId: project.createdById } }) : Promise.resolve(0),
  ]);
  const ticketsEver = settings ? 1 : await prisma.projectSupportTicket.count({ where: { projectId } });

  const [pageViews, uniques, leads, won, bookings, posts, reviews, ratings, tickets, videos] = await Promise.all([
    prisma.projectPageView.count({ where: { projectId, createdAt: range } }),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM (SELECT DISTINCT visitor_id, date_trunc('day', created_at) FROM project_page_views WHERE project_id = ${projectId} AND created_at >= ${from} AND created_at < ${to}) t`,
    prisma.lead.findMany({ where: { projectId, createdAt: range }, select: { source: true, utm: true, status: true }, take: 5000 }),
    prisma.lead.count({ where: { projectId, createdAt: range, status: 'WON' } }),
    prisma.leadBooking.count({ where: { slot: { projectId }, createdAt: range } }),
    prisma.projectPost.count({ where: { campaign: { projectId }, status: 'PUBLISHED', publishedAt: range } }),
    prisma.projectReview.count({ where: { projectId, createdAt: range } }),
    prisma.projectReview.aggregate({ where: { projectId, createdAt: range }, _avg: { rating: true } }),
    prisma.projectSupportTicket.count({ where: { projectId, createdAt: range } }),
    project ? prisma.videoRelease.count({ where: { userId: project.createdById, status: 'PUBLISHED', publishedAt: range } }) : Promise.resolve(0),
  ]);

  const avg = ratings._avg.rating;
  const raw: RawMetrics = {
    pageViews: gate(published > 0, pageViews),
    uniqueVisitors: gate(published > 0, Number(uniques[0]?.n ?? 0)),
    leads: gate(leadsEver > 0, leads.length),
    leadsWon: gate(leadsEver > 0, won),
    leadToWonPercent: gate(leads.length > 0, leads.length ? Math.round((won / leads.length) * 1000) / 10 : null),
    demoBookings: gate(slotsEver > 0, bookings),
    postsPublished: gate(campaignsEver > 0, posts),
    reviews: gate(reviewsEver > 0, reviews),
    averageRating: gate(reviews > 0 && avg != null, avg == null ? null : Math.round(avg * 10) / 10),
    supportTickets: gate(ticketsEver > 0, tickets),
    videoReleases: gate(videoEver > 0, videos),
  };
  const breakdown = breakdownLeads(leads);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    metrics: buildMetrics(raw),
    leadsBySource: breakdown.bySource,
    leadsByUtm: breakdown.byUtm,
    leadsWithoutUtm: leadsEver > 0 ? breakdown.untracked : null,
  };
}

export const GROWTH_CAVEAT =
  'These figures are measured from your own data over the same period. They show what happened, not why: a change in one number is not proof that any action caused it.';

import { prisma } from '@/lib/prisma';

import { campaignKind, type LinkRef } from './attribution';
import {
  acquisitionCost,
  buildCohorts,
  buildFunnel,
  dataHealth,
  dayKey,
  UNTRACKED,
  type AcquisitionCost,
  type AttributionModel,
  type Journey,
} from './stats';
import type { CatalogMetric } from './recommend';
import { metricId } from './recommend';

const MAX_USERS = 20_000;
const CHUNK = 4000;
const DEMO_DOMAIN = '@demo.appweaverai.invalid';

export type ActivationConfig = { requireBuild: boolean; output: 'preview_or_publish' | 'publish' | 'preview' | 'none' };
export const DEFAULT_ACTIVATION: ActivationConfig = { requireBuild: true, output: 'preview_or_publish' };
export const ACTIVATION_KEY = 'activation';

export const describeActivation = (c: ActivationConfig) => {
  const parts = [c.requireBuild ? 'first project built (an artifact exists)' : null, { preview_or_publish: 'first preview or publish', publish: 'first publish', preview: 'first preview', none: null }[c.output]].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'sign-up only';
};

export function parseActivation(value: unknown): ActivationConfig {
  const v = (value ?? {}) as Partial<ActivationConfig>;
  const outputs = ['preview_or_publish', 'publish', 'preview', 'none'] as const;
  return {
    requireBuild: typeof v.requireBuild === 'boolean' ? v.requireBuild : DEFAULT_ACTIVATION.requireBuild,
    output: (outputs as readonly string[]).includes(v.output as string) ? (v.output as ActivationConfig['output']) : DEFAULT_ACTIVATION.output,
  };
}

export async function getActivationConfig(): Promise<ActivationConfig> {
  const row = await prisma.growthConfig.findUnique({ where: { key: ACTIVATION_KEY } });
  return parseActivation(row?.value);
}

/** Activation instant: the later of the required milestones, or null while any is missing. */
export function activationTime(config: ActivationConfig, m: { builtAt: Date | null; previewAt: Date | null; publishAt: Date | null; signedUpAt: Date }): Date | null {
  const times: Date[] = [];
  if (config.requireBuild) {
    if (!m.builtAt) return null;
    times.push(m.builtAt);
  }
  const output = { preview_or_publish: [m.previewAt, m.publishAt], publish: [m.publishAt], preview: [m.previewAt], none: [] as (Date | null)[] }[config.output];
  if (config.output !== 'none') {
    const reached = output.filter((d): d is Date => d != null);
    if (!reached.length) return null;
    times.push(new Date(Math.min(...reached.map((d) => d.getTime()))));
  }
  if (!times.length) return m.signedUpAt;
  return new Date(Math.max(...times.map((d) => d.getTime())));
}

const chunks = <T,>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

type MinRow = { user_id: string; at: Date };

async function minByUser(sqlFor: (ids: string[]) => Promise<MinRow[]>, ids: string[]) {
  const out = new Map<string, Date>();
  for (const part of chunks(ids)) for (const r of await sqlFor(part)) out.set(r.user_id, new Date(r.at));
  return out;
}

/** One journey per user who signed up in [from, to). Demo accounts are excluded. */
export async function loadJourneys(from: Date, to: Date, config?: ActivationConfig): Promise<Journey[]> {
  const activation = config ?? (await getActivationConfig());
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: from, lt: to }, NOT: { email: { endsWith: DEMO_DOMAIN } } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_USERS,
  });
  if (!users.length) return [];
  const ids = users.map((u) => u.id);

  const [attributions, adAttributions, built, published, previewed, subs, invoices, activity] = await Promise.all([
    prisma.growthAttribution.findMany({ where: { userId: { in: ids } } }),
    prisma.adAttribution.findMany({ where: { userId: { in: ids } } }),
    minByUser((part) => prisma.$queryRaw<MinRow[]>`SELECT p.created_by_id AS user_id, MIN(a.created_at) AS at FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE p.created_by_id = ANY(${part}::text[]) AND p.deleted_at IS NULL GROUP BY p.created_by_id`, ids),
    minByUser((part) => prisma.$queryRaw<MinRow[]>`SELECT created_by_id AS user_id, MIN(COALESCE(published_at, created_at)) AS at FROM deployments WHERE created_by_id = ANY(${part}::text[]) AND environment::text = 'PRODUCTION' AND (status::text = 'LIVE' OR published_at IS NOT NULL) GROUP BY created_by_id`, ids),
    minByUser((part) => prisma.$queryRaw<MinRow[]>`SELECT user_id, MIN(created_at) AS at FROM growth_feature_events WHERE user_id = ANY(${part}::text[]) AND name = 'preview.opened' GROUP BY user_id`, ids),
    prisma.stripeSubscription.findMany({ where: { userId: { in: ids }, unitAmountCents: { gt: 0 } }, select: { userId: true, startedAt: true, endedAt: true } }),
    prisma.stripeInvoice.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'paid' }, _sum: { amountPaidCents: true }, _count: { _all: true } }),
    loadActiveDays(ids, from),
  ]);

  const attrBy = new Map(attributions.map((a) => [a.userId, a]));
  const adBy = new Map(adAttributions.map((a) => [a.userId, a]));
  const subsBy = new Map<string, typeof subs>();
  for (const s of subs) if (s.userId) subsBy.set(s.userId, [...(subsBy.get(s.userId) ?? []), s]);
  const invBy = new Map(invoices.filter((i) => i.userId).map((i) => [i.userId as string, i]));

  return users.map((u) => {
    const a = attrBy.get(u.id);
    const ad = adBy.get(u.id);
    const mine = subsBy.get(u.id) ?? [];
    const paidAt = mine.length ? new Date(Math.min(...mine.map((s) => s.startedAt.getTime()))) : null;
    const stillActive = mine.some((s) => !s.endedAt);
    const churnedAt = paidAt && !stillActive ? new Date(Math.max(...mine.map((s) => (s.endedAt as Date).getTime()))) : null;
    const inv = invBy.get(u.id);
    const adChannel = ad?.source ? `${ad.source.toLowerCase()}/${(ad.medium ?? 'unknown').toLowerCase()}` : null;
    return {
      userId: u.id,
      signedUpAt: u.createdAt,
      tracked: Boolean(a || adChannel),
      firstChannel: a?.firstChannel ?? adChannel ?? UNTRACKED,
      lastChannel: a?.lastChannel ?? adChannel ?? UNTRACKED,
      firstCampaign: a?.firstCampaign ?? ad?.campaign ?? null,
      lastCampaign: a?.lastCampaign ?? ad?.campaign ?? null,
      activatedAt: activationTime(activation, { builtAt: built.get(u.id) ?? null, previewAt: previewed.get(u.id) ?? null, publishAt: published.get(u.id) ?? null, signedUpAt: u.createdAt }),
      paidAt,
      churnedAt,
      revenueCents: paidAt ? (inv && inv._count._all > 0 ? (inv._sum.amountPaidCents ?? 0) : null) : 0,
      activeDays: activity.get(u.id) ?? [],
    };
  });
}

/** Real activity only: AI usage events and tracked feature use, as distinct UTC days per user. */
async function loadActiveDays(ids: string[], since: Date) {
  const out = new Map<string, Set<string>>();
  const add = (userId: string, day: string) => out.set(userId, (out.get(userId) ?? new Set()).add(day));
  for (const part of chunks(ids)) {
    const [ai, feature] = await Promise.all([
      prisma.$queryRaw<{ user_id: string; day: string }[]>`SELECT user_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM ai_usage_events WHERE user_id = ANY(${part}::text[]) AND created_at >= ${since} GROUP BY 1, 2`,
      prisma.growthFeatureEvent.findMany({ where: { userId: { in: part }, createdAt: { gte: since } }, select: { userId: true, day: true } }),
    ]);
    for (const r of ai) add(r.user_id, r.day);
    for (const r of feature) add(r.userId, r.day);
  }
  return new Map([...out.entries()].map(([k, v]) => [k, [...v].sort()]));
}

export async function visitorsByChannel(from: Date, to: Date): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ channel: string; n: bigint }[]>`SELECT channel, COUNT(DISTINCT visitor_id)::bigint AS n FROM growth_visits WHERE created_at >= ${from} AND created_at < ${to} GROUP BY channel`;
  return Object.fromEntries(rows.map((r) => [r.channel, Number(r.n)]));
}

export type SpendSummary = { adSpendByChannel: Record<string, number>; internalCostCents: number; note: string };

/**
 * Spend we can actually see: house Meta ads (cumulative per creative, so creatives launched in the period) and the
 * internal marketing cost log. Internal cost is production cost and is not attributed to a channel.
 */
export async function loadSpend(from: Date, to: Date): Promise<SpendSummary> {
  const [creatives, internal] = await Promise.all([
    prisma.adCreative.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { spendCents: true } }),
    prisma.internalMarketingCost.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { estimatedCostCents: true, actualCostCents: true } }),
  ]);
  const meta = creatives._sum.spendCents ?? 0;
  return {
    adSpendByChannel: meta > 0 ? { 'facebook/paid': meta } : {},
    internalCostCents: internal.reduce((s, r) => s + (r.actualCostCents ?? r.estimatedCostCents), 0),
    note: 'Ad spend is the lifetime spend of house ads created in the period (the provider reports one cumulative figure per ad). Internal marketing cost is the cost of producing content and is not attributed to a channel.',
  };
}

export async function loadFeatureUsage(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ name: string; users: bigint; uses: bigint }[]>`SELECT name, COUNT(DISTINCT user_id)::bigint AS users, COUNT(*)::bigint AS uses FROM growth_feature_events WHERE created_at >= ${from} AND created_at < ${to} GROUP BY name ORDER BY users DESC, name`;
  return rows.map((r) => ({ name: r.name, users: Number(r.users), uses: Number(r.uses) }));
}

export type PlatformSnapshot = {
  from: string;
  to: string;
  model: AttributionModel;
  activation: string;
  funnel: ReturnType<typeof buildFunnel>;
  cohortsWeekly: ReturnType<typeof buildCohorts>;
  cohortsMonthly: ReturnType<typeof buildCohorts>;
  spend: SpendSummary;
  costs: { channel: string; cost: AcquisitionCost; signups: number; paid: number }[];
  blended: AcquisitionCost;
  features: { name: string; users: number; uses: number }[];
  health: ReturnType<typeof dataHealth>;
  campaignKinds: { kind: string; signups: number; paid: number }[];
  journeyCount: number;
};

export async function collectPlatform(from: Date, to: Date, model: AttributionModel = 'first', now = new Date()): Promise<PlatformSnapshot> {
  const config = await getActivationConfig();
  const [journeys, visitors, spend, features, linkRows, visitTotals] = await Promise.all([
    loadJourneys(from, to, config),
    visitorsByChannel(from, to),
    loadSpend(from, to),
    loadFeatureUsage(from, to),
    prisma.growthLink.findMany({ select: { kind: true, source: true, medium: true, campaign: true, content: true }, take: 2000 }),
    prisma.$queryRaw<{ total: bigint; tagged: bigint }[]>`SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE source IS NOT NULL)::bigint AS tagged FROM growth_visits WHERE created_at >= ${from} AND created_at < ${to}`,
  ]);
  const funnel = buildFunnel(journeys, visitors, model);

  const costs = Object.entries(spend.adSpendByChannel).map(([channel, spendCents]) => {
    const row = funnel.byChannel.find((r) => r.key === channel);
    const signups = row?.signups ?? 0;
    const paid = row?.paid ?? 0;
    return { channel, signups, paid, cost: acquisitionCost({ spendCents, signups, activated: row?.activated ?? 0, paid, revenueCents: row?.revenueCents ?? null }) };
  });
  const totalSpend = Object.values(spend.adSpendByChannel).reduce((a, b) => a + b, 0) + spend.internalCostCents;
  const blended = acquisitionCost({ spendCents: totalSpend, signups: funnel.all.signups, activated: funnel.all.activated, paid: funnel.all.paid, revenueCents: funnel.all.revenueCents });

  const links: LinkRef[] = linkRows;
  const tagged = journeys.filter((j) => j.tracked && (j.firstChannel.includes('/') && !j.firstChannel.startsWith('referral/')));
  const kinds = new Map<string, { signups: number; paid: number }>();
  for (const j of journeys) {
    if (!j.tracked) continue;
    const [source, medium] = j.firstChannel.split('/');
    const kind = campaignKind({ source, medium, campaign: j.firstCampaign ?? undefined }, links);
    const cur = kinds.get(kind) ?? { signups: 0, paid: 0 };
    kinds.set(kind, { signups: cur.signups + 1, paid: cur.paid + (j.paidAt ? 1 : 0) });
  }
  const campaignList = [...new Set(tagged.map((j) => j.firstCampaign).filter((c): c is string => Boolean(c)))];
  const unrecorded = campaignList.filter((c) => !links.some((l) => l.campaign.toLowerCase() === c) && c !== 'aw_auto').length;
  const health = dataHealth({
    visits: Number(visitTotals[0]?.total ?? 0),
    visitsTagged: Number(visitTotals[0]?.tagged ?? 0),
    signups: journeys.length,
    signupsTracked: journeys.filter((j) => j.tracked).length,
    campaigns: campaignList.length,
    campaignsUnrecorded: unrecorded,
  });

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    model,
    activation: describeActivation(config),
    funnel,
    cohortsWeekly: buildCohorts(journeys, { granularity: 'week', periods: 8, now }),
    cohortsMonthly: buildCohorts(journeys, { granularity: 'month', periods: 6, now }),
    spend,
    costs,
    blended,
    features,
    health,
    campaignKinds: [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.signups - a.signups),
    journeyCount: journeys.length,
  };
}

/** Aggregated, PII-free metrics for the recommendation model and its evidence table. */
export function platformCatalog(s: PlatformSnapshot): CatalogMetric[] {
  const period = `${dayKey(new Date(s.from))}..${dayKey(new Date(s.to))}`;
  const m: CatalogMetric[] = [];
  const add = (id: string, label: string, value: number | null | undefined, unit: CatalogMetric['unit'] = 'count') => {
    if (value != null && Number.isFinite(value)) m.push({ id, label, value, unit, period });
  };
  const a = s.funnel.all;
  add('funnel.visitors', 'Consented unique visitors', a.visitors);
  add('funnel.signups', 'Signups', a.signups);
  add('funnel.activated', 'Activated users', a.activated);
  add('funnel.paid', 'Paid conversions', a.paid);
  add('funnel.visitor_to_signup', 'Visitor to signup rate', a.visitorToSignup, 'percent');
  add('funnel.signup_to_activated', 'Signup to activation rate', a.signupToActivated, 'percent');
  add('funnel.activated_to_paid', 'Activation to paid rate', a.activatedToPaid, 'percent');
  for (const r of s.funnel.byChannel.slice(0, 8)) {
    add(metricId('channel', 'signups', r.key), `Signups from ${r.key}`, r.signups);
    add(metricId('channel', 'paid', r.key), `Paid conversions from ${r.key}`, r.paid);
    if (r.visitors != null) add(metricId('channel', 'visitors', r.key), `Visitors from ${r.key}`, r.visitors);
    add(metricId('channel', 'signup_to_activated', r.key), `Activation rate for ${r.key}`, r.signupToActivated, 'percent');
  }
  for (const c of s.costs) {
    if (c.cost.cac.status === 'ok') add(metricId('channel', 'cac_cents', c.channel), `CAC for ${c.channel}`, c.cost.cac.value, 'cents');
  }
  add('health.score', 'Data health score (0-100)', s.health.score);
  add('health.untracked_signup_pct', 'Signups without attribution', s.health.untrackedSignupPct == null ? null : s.health.untrackedSignupPct / 100, 'percent');
  for (const f of s.features.slice(0, 6)) add(metricId('feature', 'users', f.name), `Users of ${f.name}`, f.users);
  return m;
}

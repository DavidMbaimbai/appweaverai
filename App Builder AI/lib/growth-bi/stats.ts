/** Pure analytics maths: funnel, cohorts, churn, acquisition cost, anomalies, forecast, data health. No I/O. */

export const MIN_CONVERSIONS = 5;
export const MIN_ANOMALY_POINTS = 14;
export const MIN_FORECAST_POINTS = 21;
export const MIN_FORECAST_TOTAL = 30;
export const DAY_MS = 86_400_000;

export type Journey = {
  userId: string;
  signedUpAt: Date;
  firstChannel: string;
  lastChannel: string;
  firstCampaign: string | null;
  lastCampaign: string | null;
  /** True when a consented first-party attribution record exists. */
  tracked: boolean;
  activatedAt: Date | null;
  paidAt: Date | null;
  churnedAt: Date | null;
  /** null = revenue not known (no invoice data), 0 = known and nothing paid. */
  revenueCents: number | null;
  /** Distinct UTC days (YYYY-MM-DD) with real product activity. */
  activeDays: string[];
};

export type AttributionModel = 'first' | 'last';
export const UNTRACKED = 'untracked';

const rate = (num: number, den: number) => (den > 0 ? num / den : null);
const channelOf = (j: Journey, model: AttributionModel) => (!j.tracked ? UNTRACKED : model === 'first' ? j.firstChannel : j.lastChannel);
const campaignOf = (j: Journey, model: AttributionModel) => (!j.tracked ? UNTRACKED : (model === 'first' ? j.firstCampaign : j.lastCampaign) ?? '(none)');

export type FunnelStage = { stage: 'visitors' | 'signups' | 'activated' | 'paid'; count: number | null; rateFromPrevious: number | null; rateFromSignups: number | null };

export type FunnelRow = {
  key: string;
  visitors: number | null;
  signups: number;
  activated: number;
  paid: number;
  visitorToSignup: number | null;
  signupToActivated: number | null;
  activatedToPaid: number | null;
  signupToPaid: number | null;
  revenueCents: number | null;
};

function row(key: string, visitors: number | null, js: Journey[]): FunnelRow {
  const signups = js.length;
  const activated = js.filter((j) => j.activatedAt).length;
  const paid = js.filter((j) => j.paidAt).length;
  const unknownPaid = js.some((j) => j.paidAt && j.revenueCents == null);
  return {
    key,
    visitors,
    signups,
    activated,
    paid,
    visitorToSignup: visitors == null ? null : rate(signups, visitors),
    signupToActivated: rate(activated, signups),
    activatedToPaid: rate(paid, activated),
    signupToPaid: rate(paid, signups),
    revenueCents: js.length && !unknownPaid ? js.reduce((sum, j) => sum + (j.revenueCents ?? 0), 0) : null,
  };
}

export function groupBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

/**
 * Visitor -> signup -> activated -> paid. `visitors` counts consented unique visitors per channel; untracked signups
 * have no visitor count, so their visitor rate is null rather than a made-up figure.
 */
export function buildFunnel(journeys: Journey[], visitorsByChannel: Record<string, number>, model: AttributionModel = 'first') {
  const totalVisitors = Object.values(visitorsByChannel).reduce((a, b) => a + b, 0);
  const all = row('all', totalVisitors > 0 ? totalVisitors : null, journeys);
  const stages: FunnelStage[] = [
    { stage: 'visitors', count: all.visitors, rateFromPrevious: null, rateFromSignups: null },
    { stage: 'signups', count: all.signups, rateFromPrevious: all.visitorToSignup, rateFromSignups: all.signups ? 1 : null },
    { stage: 'activated', count: all.activated, rateFromPrevious: all.signupToActivated, rateFromSignups: all.signupToActivated },
    { stage: 'paid', count: all.paid, rateFromPrevious: all.activatedToPaid, rateFromSignups: all.signupToPaid },
  ];
  const groups = groupBy(journeys, (j) => channelOf(j, model));
  const keys = new Set([...groups.keys(), ...Object.keys(visitorsByChannel)]);
  const byChannel = [...keys]
    .map((key) => row(key, key === UNTRACKED ? null : (visitorsByChannel[key] ?? 0), groups.get(key) ?? []))
    .sort((a, b) => b.signups - a.signups || (b.visitors ?? 0) - (a.visitors ?? 0) || a.key.localeCompare(b.key));
  const byCampaign = [...groupBy(journeys, (j) => campaignOf(j, model)).entries()]
    .map(([key, js]) => row(key, null, js))
    .sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key));
  return { all, stages, byChannel, byCampaign };
}

export const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function startOfCohort(d: Date, granularity: 'week' | 'month') {
  const day = startOfUtcDay(d);
  if (granularity === 'month') return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - dow * DAY_MS);
}

export type CohortRow = {
  cohort: string;
  size: number;
  /** Per period k: retained / eligible, null while that period has not fully elapsed for anyone in the cohort. */
  retention: ({ retained: number; eligible: number; rate: number | null } | null)[];
  paid: number;
  churned: number;
  churnRate: number | null;
};

/**
 * Retention is measured per user relative to their own signup: period k covers days [k*len, (k+1)*len) after signup
 * and counts a user as retained when they had real activity in it. A user is only eligible once the period has elapsed.
 */
export function buildCohorts(journeys: Journey[], opts: { granularity: 'week' | 'month'; periods: number; now: Date }): CohortRow[] {
  const len = opts.granularity === 'week' ? 7 : 30;
  const groups = groupBy(journeys, (j) => dayKey(startOfCohort(j.signedUpAt, opts.granularity)));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, js]) => {
      const retention = Array.from({ length: opts.periods }, (_, k) => {
        let eligible = 0;
        let retained = 0;
        for (const j of js) {
          const start = startOfUtcDay(j.signedUpAt).getTime() + k * len * DAY_MS;
          const end = start + len * DAY_MS;
          if (end > opts.now.getTime()) continue;
          eligible += 1;
          if (j.activeDays.some((d) => {
            const t = Date.parse(`${d}T00:00:00Z`);
            return t >= start && t < end;
          })) retained += 1;
        }
        return eligible ? { retained, eligible, rate: retained / eligible } : null;
      });
      const paid = js.filter((j) => j.paidAt).length;
      const churned = js.filter((j) => j.paidAt && j.churnedAt).length;
      return { cohort, size: js.length, retention, paid, churned, churnRate: rate(churned, paid) };
    });
}

export type Measured = { status: 'ok'; value: number } | { status: 'insufficient'; reason: string };
const ok = (value: number): Measured => ({ status: 'ok', value });
const insufficient = (reason: string): Measured => ({ status: 'insufficient', reason });

export type AcquisitionCost = {
  spendCents: number;
  cac: Measured;
  costPerActivation: Measured;
  roas: Measured;
};

/** Spend vs results. Never fabricates: no spend, too few conversions, or unknown revenue gives 'insufficient'. */
export function acquisitionCost(input: { spendCents: number; signups: number; activated: number; paid: number; revenueCents: number | null }, min = MIN_CONVERSIONS): AcquisitionCost {
  const { spendCents } = input;
  if (spendCents <= 0) {
    const none = insufficient('No spend recorded for this channel.');
    return { spendCents, cac: none, costPerActivation: none, roas: none };
  }
  return {
    spendCents,
    cac: input.paid >= min ? ok(spendCents / input.paid) : insufficient(`Needs at least ${min} paid conversions (have ${input.paid}).`),
    costPerActivation: input.activated >= min ? ok(spendCents / input.activated) : insufficient(`Needs at least ${min} activations (have ${input.activated}).`),
    roas:
      input.revenueCents == null
        ? insufficient('Revenue is not known for these customers.')
        : input.paid < min
          ? insufficient(`Needs at least ${min} paid conversions (have ${input.paid}).`)
          : ok(input.revenueCents / spendCents),
  };
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type Anomaly =
  | { status: 'insufficient'; reason: string }
  | { status: 'normal'; expected: number }
  | { status: 'anomaly'; kind: 'DROP' | 'SPIKE'; observed: number; expected: number; score: number };

/**
 * Compares the last point with the median of the points before it using the modified z-score (median absolute
 * deviation), which a few earlier outliers cannot distort. Small absolute moves are ignored.
 */
export function detectAnomaly(series: number[], opts: { threshold?: number; minPoints?: number; minExpected?: number } = {}): Anomaly {
  const { threshold = 3.5, minPoints = MIN_ANOMALY_POINTS, minExpected = 5 } = opts;
  if (series.length < minPoints) return { status: 'insufficient', reason: `Needs at least ${minPoints} days of data (have ${series.length}).` };
  const observed = series[series.length - 1];
  const history = series.slice(0, -1);
  const expected = median(history);
  const mad = median(history.map((v) => Math.abs(v - expected)));
  // A flat history has MAD 0; fall back to Poisson-like noise so a flat series can still be judged.
  const scale = mad > 0 ? 1.4826 * mad : Math.max(1, Math.sqrt(Math.max(expected, 1)));
  const score = (observed - expected) / scale;
  if (Math.abs(score) < threshold || Math.max(observed, expected) < minExpected || Math.abs(observed - expected) < Math.max(2, expected * 0.3)) {
    return { status: 'normal', expected };
  }
  return { status: 'anomaly', kind: score < 0 ? 'DROP' : 'SPIKE', observed, expected, score: Math.round(score * 10) / 10 };
}

export type Forecast =
  | { status: 'insufficient'; reason: string }
  | { status: 'ok'; label: string; slopePerDay: number; points: { offset: number; value: number }[]; total: number };

export const FORECAST_LABEL = 'Projection based on the trailing trend, not a prediction. It assumes recent behaviour continues.';

/** Least-squares line through the trailing window, projected forward. Refuses on short or thin data. */
export function forecastTrend(series: number[], opts: { horizon?: number; window?: number } = {}): Forecast {
  const { horizon = 14, window = 28 } = opts;
  const data = series.slice(-window);
  const total = data.reduce((a, b) => a + b, 0);
  if (data.length < MIN_FORECAST_POINTS) return { status: 'insufficient', reason: `Needs at least ${MIN_FORECAST_POINTS} days of data (have ${data.length}).` };
  if (total < MIN_FORECAST_TOTAL) return { status: 'insufficient', reason: `Needs at least ${MIN_FORECAST_TOTAL} events in the window (have ${total}).` };
  const n = data.length;
  const xm = (n - 1) / 2;
  const ym = total / n;
  let num = 0;
  let den = 0;
  data.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  const slope = den ? num / den : 0;
  const points = Array.from({ length: horizon }, (_, i) => ({ offset: i + 1, value: Math.max(0, ym + slope * (n - 1 + i + 1 - xm)) }));
  return { status: 'ok', label: FORECAST_LABEL, slopePerDay: slope, points, total: points.reduce((a, p) => a + p.value, 0) };
}

export type HealthInput = { visits: number; visitsTagged: number; signups: number; signupsTracked: number; campaignsUnrecorded: number; campaigns: number };
export type Health = { score: number | null; missingUtmPct: number | null; untrackedSignupPct: number | null; unrecordedLinkPct: number | null; notes: string[] };

/** 0-100 where 100 = every visit tagged, every signup attributed and every campaign link recorded. null when there is nothing to judge. */
export function dataHealth(i: HealthInput): Health {
  const missingUtm = i.visits > 0 ? 1 - i.visitsTagged / i.visits : null;
  const untracked = i.signups > 0 ? 1 - i.signupsTracked / i.signups : null;
  const unrecorded = i.campaigns > 0 ? i.campaignsUnrecorded / i.campaigns : null;
  const parts = [
    { w: 0.4, v: untracked },
    { w: 0.3, v: missingUtm },
    { w: 0.3, v: unrecorded },
  ].filter((p): p is { w: number; v: number } => p.v != null);
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const score = wsum ? Math.round(100 * (1 - parts.reduce((a, p) => a + p.w * p.v, 0) / wsum)) : null;
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);
  const notes: string[] = [];
  if (untracked != null && untracked > 0.5) notes.push('Most signups have no attribution: they arrived without consent, with DNT/GPC, or before tracking started.');
  if (missingUtm != null && missingUtm > 0.5) notes.push('Most consented visits carry no UTM tags: tag outbound links with the UTM builder.');
  if (unrecorded != null && unrecorded > 0) notes.push('Some tagged campaigns have no recorded link: create them with the UTM builder so they resolve to a campaign type.');
  return { score, missingUtmPct: pct(missingUtm), untrackedSignupPct: pct(untracked), unrecordedLinkPct: pct(unrecorded), notes };
}

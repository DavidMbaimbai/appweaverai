/** Pure revenue maths over the append-only MRR history. All amounts are cents in a single currency. */

export type MrrChange = {
  subscriptionId: string;
  planId: string | null;
  mrrCents: number;
  effectiveAt: Date;
};

type SubMrr = { mrrCents: number; planId: string | null };

/** Each subscription's latest MRR at or before `at`. */
export function mrrSnapshot(changes: MrrChange[], at: Date): Map<string, SubMrr> {
  const latest = new Map<string, MrrChange>();
  for (const change of changes) {
    if (change.effectiveAt > at) continue;
    const current = latest.get(change.subscriptionId);
    if (!current || change.effectiveAt >= current.effectiveAt) latest.set(change.subscriptionId, change);
  }
  const out = new Map<string, SubMrr>();
  for (const [id, c] of latest) out.set(id, { mrrCents: c.mrrCents, planId: c.planId });
  return out;
}

export const totalMrr = (snapshot: Map<string, SubMrr>) => [...snapshot.values()].reduce((sum, s) => sum + s.mrrCents, 0);
export const payingCount = (snapshot: Map<string, SubMrr>) => [...snapshot.values()].filter((s) => s.mrrCents > 0).length;
export const arrRunRate = (mrrCents: number) => mrrCents * 12;

export function mrrTrend(changes: MrrChange[], months: number, now: Date) {
  const points: { month: string; mrrCents: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1) - 1);
    const at = i === 0 ? now : monthEnd;
    points.push({
      month: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
      mrrCents: totalMrr(mrrSnapshot(changes, at)),
    });
  }
  return points;
}

export type Retention = {
  startMrrCents: number;
  churnedCents: number;
  contractionCents: number;
  expansionCents: number;
  /** (start - churn - contraction + expansion) / start. Excludes subscriptions that began after `from`. */
  netRevenueRetention: number;
  grossRevenueChurn: number;
  customerChurn: number;
  startCustomers: number;
};

/** Cohort retention between two instants; null when nobody was paying at `from` (nothing to measure). */
export function retention(changes: MrrChange[], from: Date, to: Date): Retention | null {
  const start = mrrSnapshot(changes, from);
  const end = mrrSnapshot(changes, to);
  let startTotal = 0;
  let churned = 0;
  let contraction = 0;
  let expansion = 0;
  let startCustomers = 0;
  let lostCustomers = 0;
  for (const [id, s] of start) {
    if (s.mrrCents <= 0) continue;
    startTotal += s.mrrCents;
    startCustomers += 1;
    const after = end.get(id)?.mrrCents ?? 0;
    if (after <= 0) {
      churned += s.mrrCents;
      lostCustomers += 1;
    } else if (after < s.mrrCents) contraction += s.mrrCents - after;
    else expansion += after - s.mrrCents;
  }
  if (startTotal === 0) return null;
  return {
    startMrrCents: startTotal,
    churnedCents: churned,
    contractionCents: contraction,
    expansionCents: expansion,
    netRevenueRetention: (startTotal - churned - contraction + expansion) / startTotal,
    grossRevenueChurn: (churned + contraction) / startTotal,
    customerChurn: lostCustomers / startCustomers,
    startCustomers,
  };
}

export function planMix(snapshot: Map<string, SubMrr>) {
  const mix = new Map<string, { planId: string; subscriptions: number; mrrCents: number }>();
  for (const s of snapshot.values()) {
    if (s.mrrCents <= 0) continue;
    const key = s.planId ?? 'unknown';
    const row = mix.get(key) ?? { planId: key, subscriptions: 0, mrrCents: 0 };
    row.subscriptions += 1;
    row.mrrCents += s.mrrCents;
    mix.set(key, row);
  }
  return [...mix.values()].sort((a, b) => b.mrrCents - a.mrrCents);
}

/** Gross margin as a fraction, or null when revenue or cost data is missing (never a made-up number). */
export function grossMargin(revenueCents: number | null, costCents: number | null) {
  if (revenueCents === null || costCents === null || revenueCents <= 0) return null;
  return (revenueCents - costCents) / revenueCents;
}

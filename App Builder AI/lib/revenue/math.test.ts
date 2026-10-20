import { describe, expect, it } from 'vitest';

import { grossMargin, mrrSnapshot, mrrTrend, payingCount, planMix, retention, totalMrr, arrRunRate, type MrrChange } from './math';
import { monthlyCents } from '@/lib/billing/stripe-sync';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const c = (subscriptionId: string, planId: string, mrrCents: number, at: string): MrrChange => ({ subscriptionId, planId, mrrCents, effectiveAt: d(at) });

// A: 2000 -> 4000 (upgrade, Feb). B: 1000 -> 0 (churn, Mar). C: 1000 -> 800 (downgrade, Mar). D: new in Mar at 3000.
const fixture: MrrChange[] = [
  c('A', 'builder', 2000, '2026-01-10'),
  c('B', 'builder', 1000, '2026-01-15'),
  c('C', 'builder', 1000, '2026-01-20'),
  c('A', 'pro', 4000, '2026-02-10'),
  c('B', 'builder', 0, '2026-03-05'),
  c('C', 'builder', 800, '2026-03-06'),
  c('D', 'pro', 3000, '2026-03-07'),
];

describe('MRR maths', () => {
  it('normalises prices to a monthly amount', () => {
    expect(monthlyCents(2000, 1, 'month', 1)).toBe(2000);
    expect(monthlyCents(24000, 1, 'year', 1)).toBe(2000);
    expect(monthlyCents(1000, 3, 'month', 1)).toBe(3000);
    expect(monthlyCents(3000, 1, 'month', 3)).toBe(1000);
    expect(monthlyCents(100, 1, 'one_time', 1)).toBe(0);
  });

  it('computes current MRR, ARR and paying subscriptions from the latest change per subscription', () => {
    const snap = mrrSnapshot(fixture, d('2026-03-31'));
    expect(totalMrr(snap)).toBe(4000 + 0 + 800 + 3000);
    expect(payingCount(snap)).toBe(3);
    expect(arrRunRate(totalMrr(snap))).toBe(7800 * 12);
  });

  it('builds the monthly trend as of each month end', () => {
    const trend = mrrTrend(fixture, 3, d('2026-03-31'));
    expect(trend.map((p) => p.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(trend.map((p) => p.mrrCents)).toEqual([4000, 6000, 7800]);
  });

  it('computes NRR and churn for the cohort paying at the start of March', () => {
    const r = retention(fixture, d('2026-03-01'), d('2026-03-31'))!;
    expect(r.startMrrCents).toBe(6000);
    expect(r.churnedCents).toBe(1000);
    expect(r.contractionCents).toBe(200);
    expect(r.expansionCents).toBe(0);
    expect(r.netRevenueRetention).toBeCloseTo((6000 - 1000 - 200) / 6000);
    expect(r.grossRevenueChurn).toBeCloseTo(1200 / 6000);
    expect(r.customerChurn).toBeCloseTo(1 / 3);
  });

  it('counts expansion and excludes customers who joined mid-period', () => {
    const r = retention(fixture, d('2026-02-01'), d('2026-02-28'))!;
    expect(r.startMrrCents).toBe(4000);
    expect(r.expansionCents).toBe(2000);
    expect(r.netRevenueRetention).toBeCloseTo(1.5);
  });

  it('returns null rather than a number when nobody was paying at the start', () => {
    expect(retention(fixture, d('2025-12-01'), d('2026-03-31'))).toBeNull();
    expect(retention([], d('2026-01-01'), d('2026-02-01'))).toBeNull();
  });

  it('summarises plan mix by MRR and ignores cancelled subscriptions', () => {
    const mix = planMix(mrrSnapshot(fixture, d('2026-03-31')));
    expect(mix).toEqual([
      { planId: 'pro', subscriptions: 2, mrrCents: 7000 },
      { planId: 'builder', subscriptions: 1, mrrCents: 800 },
    ]);
  });

  it('gross margin is not available without revenue or cost data', () => {
    expect(grossMargin(10_000, 2_500)).toBeCloseTo(0.75);
    expect(grossMargin(null, 100)).toBeNull();
    expect(grossMargin(100, null)).toBeNull();
    expect(grossMargin(0, 100)).toBeNull();
  });
});

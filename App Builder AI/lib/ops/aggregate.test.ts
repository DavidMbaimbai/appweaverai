import { describe, expect, it } from 'vitest';

import {
  bucketByDay,
  deploymentDurationMs,
  dayKey,
  formatDuration,
  inRange,
  kpis,
  statusDistribution,
  successRate,
  successRateByEnvironment,
  weeklyTrend,
  type OpsDeploymentPoint,
} from './aggregate';

const now = new Date('2026-10-20T12:00:00Z');
const d = (
  createdAt: string,
  status: string,
  environment: 'PRODUCTION' | 'STAGING' = 'PRODUCTION',
): OpsDeploymentPoint => ({ createdAt, status, environment });

describe('ops aggregation', () => {
  it('buckets by day, zero-fills, and ignores items outside the window', () => {
    const buckets = bucketByDay(
      [
        d('2026-10-20T01:00:00Z', 'LIVE'),
        d('2026-10-20T02:00:00Z', 'FAILED'),
        d('2026-10-18T02:00:00Z', 'SUPERSEDED'),
        d('2026-10-19T02:00:00Z', 'BUILDING'),
        d('2026-09-01T02:00:00Z', 'LIVE'),
      ],
      7,
      now,
    );
    expect(buckets).toHaveLength(7);
    expect(buckets[0].day).toBe('2026-10-14');
    expect(buckets[6]).toMatchObject({ day: '2026-10-20', success: 1, failed: 1, total: 2 });
    expect(buckets[5]).toMatchObject({ day: '2026-10-19', running: 1 });
    expect(buckets[4].success).toBe(1);
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(4);
  });

  it('assigns days in the requested time zone, not the server zone', () => {
    const late = '2026-10-19T23:30:00Z';
    expect(dayKey(late, 'UTC')).toBe('2026-10-19');
    expect(dayKey(late, 'Europe/Amsterdam')).toBe('2026-10-20');
    expect(dayKey(late, 'America/Los_Angeles')).toBe('2026-10-19');
    const buckets = bucketByDay([d(late, 'LIVE')], 2, now, 'Europe/Amsterdam');
    expect(buckets.map((b) => [b.day, b.total])).toEqual([
      ['2026-10-19', 0],
      ['2026-10-20', 1],
    ]);
  });

  it('handles DST boundaries and month ends when generating day keys', () => {
    const buckets = bucketByDay([], 3, new Date('2026-03-01T10:00:00Z'));
    expect(buckets.map((b) => b.day)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    const dst = bucketByDay([], 2, new Date('2026-10-25T10:00:00Z'), 'Europe/Amsterdam');
    expect(dst.map((b) => b.day)).toEqual(['2026-10-24', '2026-10-25']);
  });

  it('computes success rate over finished deployments only', () => {
    expect(successRate([])).toBeNull();
    expect(successRate([{ status: 'BUILDING' }])).toBeNull();
    expect(
      successRate([{ status: 'LIVE' }, { status: 'SUPERSEDED' }, { status: 'FAILED' }, { status: 'PENDING' }]),
    ).toBe(66.7);
  });

  it('distributes statuses and per-environment rates', () => {
    const items = [
      d('2026-10-20T01:00:00Z', 'LIVE'),
      d('2026-10-20T01:00:00Z', 'FAILED', 'STAGING'),
      d('2026-10-20T01:00:00Z', 'LIVE', 'STAGING'),
      d('2026-10-20T01:00:00Z', 'PROMOTING'),
    ];
    expect(statusDistribution(items)).toEqual({ success: 2, failed: 1, running: 1 });
    expect(kpis(items)).toMatchObject({ total: 4, successful: 2, failed: 1, running: 1, successRate: 66.7 });
    expect(successRateByEnvironment(items)).toEqual({
      PRODUCTION: { total: 2, rate: 100 },
      STAGING: { total: 2, rate: 50 },
    });
    expect(successRateByEnvironment([]).PRODUCTION).toEqual({ total: 0, rate: null });
  });

  it('builds rolling weekly trend and range filter', () => {
    const items = [d('2026-10-20T01:00:00Z', 'LIVE'), d('2026-10-10T01:00:00Z', 'FAILED')];
    const weeks = weeklyTrend(items, 2, now);
    expect(weeks).toHaveLength(2);
    expect(weeks[1]).toMatchObject({ total: 1, success: 1 });
    expect(weeks[0]).toMatchObject({ total: 1, failed: 1 });
    expect(inRange(items, 7, now)).toHaveLength(1);
  });

  it('computes durations', () => {
    expect(
      deploymentDurationMs({
        status: 'LIVE',
        createdAt: '2026-10-20T00:00:00Z',
        publishedAt: '2026-10-20T00:01:05Z',
        updatedAt: '2026-10-20T00:05:00Z',
      }),
    ).toBe(65_000);
    expect(
      deploymentDurationMs({ status: 'BUILDING', createdAt: now, publishedAt: null, updatedAt: now }),
    ).toBeNull();
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(null)).toBe('—');
  });
});

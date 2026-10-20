import { describe, expect, it } from 'vitest';

import { bucketByAge, computeQualityScore, gradeFor, scoreFromCounts, topFiles, trendOf } from './score';

const f = (severity: string, status = 'OPEN') => ({ severity, status }) as never;

describe('computeQualityScore', () => {
  it('is 100 with no findings', () => {
    expect(computeQualityScore([]).score).toBe(100);
  });

  it('weights severities: critical 25, high 10, medium 3, low 1', () => {
    expect(computeQualityScore([f('CRITICAL'), f('HIGH'), f('MEDIUM'), f('LOW')]).score).toBe(100 - 39);
  });

  it('counts acknowledged at half and fixed at zero', () => {
    expect(computeQualityScore([f('HIGH', 'ACKNOWLEDGED')]).score).toBe(95);
    expect(computeQualityScore([f('CRITICAL', 'FIXED')]).score).toBe(100);
  });

  it('caps each severity so many lows cannot zero the score', () => {
    const lows = Array.from({ length: 500 }, () => f('LOW'));
    expect(computeQualityScore(lows).score).toBe(100 - 60);
  });

  it('never goes below 0 and reports a breakdown', () => {
    const many = [...Array.from({ length: 10 }, () => f('CRITICAL')), ...Array.from({ length: 20 }, () => f('HIGH'))];
    const result = computeQualityScore(many);
    expect(result.score).toBe(0);
    expect(result.breakdown.find((r) => r.severity === 'CRITICAL')).toMatchObject({ open: 10, penalty: 60 });
  });

  it('maps grades at the boundaries', () => {
    expect([gradeFor(90), gradeFor(89), gradeFor(75), gradeFor(60), gradeFor(40), gradeFor(39)]).toEqual(['A', 'B', 'B', 'C', 'D', 'F']);
  });

  it('derives history scores from stored counts', () => {
    expect(scoreFromCounts({ critical: 1, high: 0, medium: 0, low: 0 })).toBe(75);
  });
});

describe('dashboard helpers', () => {
  const now = new Date('2026-06-30T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it('buckets only open findings by age', () => {
    const buckets = bucketByAge(
      [
        { status: 'OPEN', firstSeenAt: ago(0.2) },
        { status: 'OPEN', firstSeenAt: ago(3) },
        { status: 'OPEN', firstSeenAt: ago(10) },
        { status: 'OPEN', firstSeenAt: ago(90) },
        { status: 'FIXED', firstSeenAt: ago(90) },
        { status: 'ACKNOWLEDGED', firstSeenAt: ago(90) },
      ],
      now,
    );
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  it('ranks files by severity weight, not just count', () => {
    const rows = topFiles([
      { file: 'a.js', severity: 'LOW', status: 'OPEN' },
      { file: 'a.js', severity: 'LOW', status: 'OPEN' },
      { file: 'b.js', severity: 'CRITICAL', status: 'OPEN' },
      { file: 'c.js', severity: 'CRITICAL', status: 'FIXED' },
    ]);
    expect(rows.map((r) => r.file)).toEqual(['b.js', 'a.js']);
  });

  it('reports trend direction', () => {
    const p = (score: number) => ({ id: String(score), createdAt: '', score, critical: 0, high: 0, medium: 0, low: 0 });
    expect(trendOf([p(50)]).direction).toBe('none');
    expect(trendOf([p(50), p(70)])).toEqual({ direction: 'up', delta: 20 });
    expect(trendOf([p(70), p(60)]).direction).toBe('down');
  });
});

import { describe, expect, it } from 'vitest';

import { backupReportSchema, evaluateBackupHealth } from './index';
import { compareRowCounts } from './verify';

const now = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const limits = { backupHours: 30, drillDays: 10 };

describe('evaluateBackupHealth', () => {
  it('flags a missing backup and an unrun drill', () => {
    const health = evaluateBackupHealth([], now, limits);
    expect(health.ok).toBe(false);
    expect(health.issues[0]).toMatch(/No successful database backup/);
    expect(health.warnings[0]).toMatch(/No successful restore drill/);
  });

  it('is healthy with a fresh backup and a recent drill', () => {
    const health = evaluateBackupHealth(
      [
        { kind: 'BACKUP', status: 'SUCCESS', finishedAt: hoursAgo(5) },
        { kind: 'RESTORE_DRILL', status: 'SUCCESS', finishedAt: hoursAgo(48) },
      ],
      now,
      limits,
    );
    expect(health).toMatchObject({ ok: true, issues: [], warnings: [] });
  });

  it('flags stale backups and failures newer than the last success', () => {
    const stale = evaluateBackupHealth([{ kind: 'BACKUP', status: 'SUCCESS', finishedAt: hoursAgo(40) }], now, limits);
    expect(stale.issues.join()).toMatch(/40h old/);

    const failing = evaluateBackupHealth(
      [
        { kind: 'BACKUP', status: 'SUCCESS', finishedAt: hoursAgo(26) },
        { kind: 'BACKUP', status: 'FAILED', finishedAt: hoursAgo(2) },
      ],
      now,
      limits,
    );
    expect(failing.issues.join()).toMatch(/most recent backup run failed/);
  });

  it('treats a failed drill as an issue and an old drill as a warning', () => {
    const base = { kind: 'BACKUP', status: 'SUCCESS', finishedAt: hoursAgo(1) };
    const failedDrill = evaluateBackupHealth([base, { kind: 'RESTORE_DRILL', status: 'FAILED', finishedAt: hoursAgo(1) }], now, limits);
    expect(failedDrill.issues.join()).toMatch(/restore drill failed/);
    const oldDrill = evaluateBackupHealth([base, { kind: 'RESTORE_DRILL', status: 'SUCCESS', finishedAt: hoursAgo(24 * 12) }], now, limits);
    expect(oldDrill.issues).toEqual([]);
    expect(oldDrill.warnings.join()).toMatch(/12 days old/);
  });
});

describe('compareRowCounts', () => {
  it('accepts counts inside the before/after window and flags the rest', () => {
    expect(compareRowCounts({ a: 5, b: 2 }, { a: 7, b: 2 }, { a: 6, b: 2 })).toEqual([]);
    const mismatches = compareRowCounts({ a: 5, b: 2, c: 1 }, { a: 5, b: 2, c: 1 }, { a: 4, b: 2 });
    expect(mismatches.map((m) => m.table)).toEqual(['a', 'c']);
    expect(mismatches[1].actual).toBeNull();
  });
});

describe('backupReportSchema', () => {
  it('applies defaults and rejects bad statuses', () => {
    const ok = backupReportSchema.parse({ status: 'SUCCESS', startedAt: '2026-10-20T01:00:00Z', finishedAt: '2026-10-20T01:05:00Z' });
    expect(ok).toMatchObject({ kind: 'BACKUP', trigger: 'SCHEDULE', encrypted: false });
    expect(backupReportSchema.safeParse({ status: 'MAYBE', startedAt: 'x', finishedAt: 'y' }).success).toBe(false);
  });
});

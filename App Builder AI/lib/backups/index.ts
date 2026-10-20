import { z } from 'zod';

import { sendAlert } from '@/lib/alerts';
import type { Prisma } from '@/lib/generated/prisma/client';
import { captureMessage } from '@/lib/monitoring';
import { prisma } from '@/lib/prisma';

export const BACKUP_KINDS = ['BACKUP', 'RESTORE_DRILL'] as const;

export const backupReportSchema = z.object({
  kind: z.enum(BACKUP_KINDS).default('BACKUP'),
  status: z.enum(['SUCCESS', 'FAILED']),
  trigger: z.enum(['SCHEDULE', 'MANUAL']).default('SCHEDULE'),
  location: z.string().max(1000).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  encrypted: z.boolean().default(false),
  retentionDeleted: z.number().int().nonnegative().default(0),
  rowCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  error: z.string().max(4000).optional(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date(),
});

export type BackupReport = z.infer<typeof backupReportSchema>;

export type BackupRunRow = {
  id: string;
  kind: string;
  status: string;
  trigger: string;
  location: string | null;
  sizeBytes: number | null;
  encrypted: boolean;
  retentionDeleted: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date;
};

export function maxBackupAgeHours() {
  const value = Number(process.env.BACKUP_MAX_AGE_HOURS);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export function maxDrillAgeDays() {
  const value = Number(process.env.BACKUP_DRILL_MAX_AGE_DAYS);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

export type BackupHealth = {
  ok: boolean;
  /** Problems that should page someone: no/stale/failing backups. */
  issues: string[];
  /** Softer findings: restore drills overdue. */
  warnings: string[];
  lastBackupAt: Date | null;
  lastDrillAt: Date | null;
};

type HealthRun = Pick<BackupRunRow, 'kind' | 'status' | 'finishedAt'>;

/** Pure evaluation of the recent run history (newest first or any order). */
export function evaluateBackupHealth(
  runs: HealthRun[],
  now = new Date(),
  limits = { backupHours: maxBackupAgeHours(), drillDays: maxDrillAgeDays() },
): BackupHealth {
  const newestFirst = [...runs].sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  const backups = newestFirst.filter((run) => run.kind === 'BACKUP');
  const drills = newestFirst.filter((run) => run.kind === 'RESTORE_DRILL');
  const lastBackup = backups.find((run) => run.status === 'SUCCESS') ?? null;
  const lastDrill = drills.find((run) => run.status === 'SUCCESS') ?? null;
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!lastBackup) {
    issues.push('No successful database backup has been recorded.');
  } else {
    const ageHours = (now.getTime() - lastBackup.finishedAt.getTime()) / 3_600_000;
    if (ageHours > limits.backupHours) {
      issues.push(`Last successful backup is ${Math.floor(ageHours)}h old (limit ${limits.backupHours}h).`);
    }
  }
  if (backups[0]?.status === 'FAILED') issues.push('The most recent backup run failed.');

  if (!lastDrill) {
    warnings.push('No successful restore drill has been recorded.');
  } else {
    const ageDays = (now.getTime() - lastDrill.finishedAt.getTime()) / 86_400_000;
    if (ageDays > limits.drillDays) {
      warnings.push(`Last successful restore drill is ${Math.floor(ageDays)} days old (limit ${limits.drillDays}).`);
    }
  }
  if (drills[0]?.status === 'FAILED') issues.push('The most recent restore drill failed - backups may not be restorable.');

  return {
    ok: issues.length === 0 && warnings.length === 0,
    issues,
    warnings,
    lastBackupAt: lastBackup?.finishedAt ?? null,
    lastDrillAt: lastDrill?.finishedAt ?? null,
  };
}

export async function listBackupRuns(take = 30): Promise<BackupRunRow[]> {
  const rows = await prisma.backupRun.findMany({ orderBy: { finishedAt: 'desc' }, take });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    trigger: row.trigger,
    location: row.location,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    encrypted: row.encrypted,
    retentionDeleted: row.retentionDeleted,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }));
}

export async function getBackupHealth(now = new Date()): Promise<BackupHealth> {
  const runs = await prisma.backupRun.findMany({
    orderBy: { finishedAt: 'desc' },
    take: 60,
    select: { kind: true, status: true, finishedAt: true },
  });
  return evaluateBackupHealth(runs, now);
}

/** Stores a run reported by the backup workflow; failures raise an alert immediately. */
export async function recordBackupRun(input: BackupReport) {
  const run = await prisma.backupRun.create({
    data: {
      kind: input.kind,
      status: input.status,
      trigger: input.trigger,
      location: input.location ?? null,
      sizeBytes: input.sizeBytes ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      encrypted: input.encrypted,
      retentionDeleted: input.retentionDeleted,
      rowCounts: (input.rowCounts ?? undefined) as Prisma.InputJsonValue | undefined,
      error: input.error ?? null,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  });
  if (input.status === 'FAILED') {
    const label = input.kind === 'BACKUP' ? 'Database backup' : 'Backup restore drill';
    await sendAlert(`${label} FAILED`, input.error ?? 'No error detail was reported.');
    await captureMessage(`${label} failed`, 'error', { tags: { job: 'backups' } });
  }
  return run;
}

/** Cron watchdog: alerts when backups are missing, stale, failing or when restore drills are overdue. */
export async function checkBackupHealthAndAlert(now = new Date()) {
  const health = await getBackupHealth(now);
  if (health.issues.length) {
    await sendAlert('Database backups need attention', health.issues.join('\n'));
  } else if (health.warnings.length) {
    await sendAlert('Backup restore drill overdue', health.warnings.join('\n'));
  }
  return health;
}

import { getAppTier, type AppTier } from '@/lib/billing/entitlements';
import { prisma } from '@/lib/prisma';
import { getUserBillingFields } from '@/lib/queries/billing';

import { runCodeScan } from './service';

export type ScheduleFrequency = 'DAILY' | 'WEEKLY';

export const SCHEDULE_FREQUENCIES: ScheduleFrequency[] = ['DAILY', 'WEEKLY'];
/** Scheduled scans are deterministic and spend no credits; they are a Pro feature to bound background load. */
export const SCHEDULED_SCAN_TIERS: AppTier[] = ['pro'];
export const MAX_SCHEDULED_PER_TICK = 25;

export function canSchedule(tier: AppTier): boolean {
  return SCHEDULED_SCAN_TIERS.includes(tier);
}

export function computeNextRun(frequency: ScheduleFrequency, from: Date): Date {
  const days = frequency === 'DAILY' ? 1 : 7;
  return new Date(from.getTime() + days * 86_400_000);
}

export type StoredSchedule = {
  enabled: boolean;
  frequency: ScheduleFrequency;
  lastRunAt: string | null;
  nextRunAt: string;
  lastError: string | null;
};

function toStored(row: {
  enabled: boolean;
  frequency: string;
  lastRunAt: Date | null;
  nextRunAt: Date;
  lastError: string | null;
}): StoredSchedule {
  return {
    enabled: row.enabled,
    frequency: row.frequency === 'DAILY' ? 'DAILY' : 'WEEKLY',
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt.toISOString(),
    lastError: row.lastError,
  };
}

export async function getSchedule(projectId: string): Promise<StoredSchedule | null> {
  const row = await prisma.scanSchedule.findUnique({ where: { projectId } });
  return row ? toStored(row) : null;
}

export async function ownerTier(projectId: string): Promise<AppTier> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspace: { select: { ownerId: true } } } });
  if (!project) return 'guest';
  return getAppTier(await getUserBillingFields(project.workspace.ownerId));
}

export async function setSchedule(input: {
  projectId: string;
  userId: string;
  enabled: boolean;
  frequency: ScheduleFrequency;
}): Promise<{ ok: true; schedule: StoredSchedule } | { ok: false; error: string }> {
  if (input.enabled && !canSchedule(await ownerTier(input.projectId))) {
    return { ok: false, error: 'Scheduled re-scans are part of the Pro plan.' };
  }
  const now = new Date();
  const row = await prisma.scanSchedule.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      enabled: input.enabled,
      frequency: input.frequency,
      nextRunAt: computeNextRun(input.frequency, now),
      createdById: input.userId,
    },
    update: {
      enabled: input.enabled,
      frequency: input.frequency,
      nextRunAt: computeNextRun(input.frequency, now),
      lastError: null,
    },
  });
  return { ok: true, schedule: toStored(row) };
}

export type DueScanSummary = { ran: number; skipped: number; failed: number };

/** Cron entry point: scans due projects. Projects whose owner is no longer on a qualifying plan are skipped and flagged. */
export async function runDueScans(now = new Date(), limit = MAX_SCHEDULED_PER_TICK): Promise<DueScanSummary> {
  const due = await prisma.scanSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now }, project: { deletedAt: null } },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
  });
  const summary: DueScanSummary = { ran: 0, skipped: 0, failed: 0 };

  for (const schedule of due) {
    const frequency: ScheduleFrequency = schedule.frequency === 'DAILY' ? 'DAILY' : 'WEEKLY';
    const next = computeNextRun(frequency, now);
    if (!canSchedule(await ownerTier(schedule.projectId))) {
      await prisma.scanSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: next, lastError: 'Skipped: the plan no longer includes scheduled re-scans.' },
      });
      summary.skipped++;
      continue;
    }
    try {
      await runCodeScan({ projectId: schedule.projectId, trigger: 'SCHEDULED', source: 'WORKING' });
      await prisma.scanSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt: next, lastError: null },
      });
      summary.ran++;
    } catch {
      await prisma.scanSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: next, lastError: 'The scheduled scan failed and will be retried next cycle.' },
      });
      summary.failed++;
    }
  }
  return summary;
}

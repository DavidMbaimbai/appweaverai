import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { contentRun: { create: db.create, findUnique: db.findUnique } },
}));

import { getOrCreateRun } from './engine';
import {
  dueRunDate,
  findDuplicate,
  gateApproval,
  normalizeConfig,
  planSlots,
  runStatusFromSteps,
  videoStepFromJob,
} from './logic';

const base = { enabled: true, paused: false, timeOfDay: '09:00', lastRunAt: null as Date | null };

describe('dueRunDate', () => {
  const now = new Date('2026-03-10T17:30:00Z');
  it('depends on the pipeline time zone', () => {
    expect(dueRunDate({ ...base, timeZone: 'Europe/Amsterdam' }, now)).toBe('2026-03-10');
    expect(dueRunDate({ ...base, timeZone: 'America/Los_Angeles' }, now)).toBe('2026-03-10');
    expect(dueRunDate({ ...base, timeZone: 'America/Los_Angeles', timeOfDay: '11:00' }, now)).toBeNull();
    expect(dueRunDate({ ...base, timeZone: 'Asia/Tokyo' }, now)).toBeNull();
    expect(dueRunDate({ ...base, timeZone: 'Asia/Tokyo', timeOfDay: '02:00' }, now)).toBe('2026-03-11');
  });
  it('is not due before the local time of day', () => {
    expect(dueRunDate({ ...base, timeZone: 'UTC' }, new Date('2026-03-10T08:59:00Z'))).toBeNull();
  });
  it('runs once per local day and respects pause', () => {
    expect(dueRunDate({ ...base, timeZone: 'UTC', lastRunAt: new Date('2026-03-10T09:05:00Z') }, now)).toBeNull();
    expect(dueRunDate({ ...base, timeZone: 'UTC', lastRunAt: new Date('2026-03-09T09:05:00Z') }, now)).toBe('2026-03-10');
    expect(dueRunDate({ ...base, timeZone: 'UTC', paused: true }, now)).toBeNull();
  });
});

describe('getOrCreateRun idempotency', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns the existing run when the day already has one', async () => {
    const existing = { id: 'r1' };
    db.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    db.findUnique.mockResolvedValue(existing);
    const result = await getOrCreateRun('p1', '2026-03-10', 'cron');
    expect(result).toEqual({ run: existing, created: false });
  });
  it('creates a run the first time', async () => {
    db.create.mockResolvedValue({ id: 'r2' });
    expect((await getOrCreateRun('p1', '2026-03-10', 'cron')).created).toBe(true);
  });
});

describe('duplicate detection', () => {
  const old = 'Launch week is here: build your app with AppWeaver in minutes and ship it today';
  it('flags near duplicates', () => {
    expect(findDuplicate('Launch week is here: build your app with AppWeaver in minutes and ship it', [old])).not.toBeNull();
  });
  it('allows distinct posts', () => {
    expect(findDuplicate('Our templates now cover restaurants and salons', [old])).toBeNull();
  });
});

describe('mode gating', () => {
  const gate = {
    enabled: true,
    paused: false,
    agentCategories: ['social_post'],
    pipelineCategories: ['social_post'],
    category: 'social_post',
    scope: 'PROJECT' as const,
  };
  it('drafts in assist and approval modes', () => {
    expect(gateApproval({ ...gate, mode: 'ASSIST' }).approve).toBe(false);
    expect(gateApproval({ ...gate, mode: 'APPROVAL' }).approve).toBe(false);
  });
  it('approves only in autonomous mode with the category allowed on both sides', () => {
    expect(gateApproval({ ...gate, mode: 'AUTONOMOUS' }).approve).toBe(true);
    expect(gateApproval({ ...gate, mode: 'AUTONOMOUS', pipelineCategories: [] }).approve).toBe(false);
    expect(gateApproval({ ...gate, mode: 'AUTONOMOUS', agentCategories: [] }).approve).toBe(false);
    expect(gateApproval({ ...gate, mode: 'AUTONOMOUS', globalPause: true }).approve).toBe(false);
  });
});

describe('video step', () => {
  it('never reports a failed or output-less job as done', () => {
    expect(videoStepFromJob({ status: 'FAILED', outputKey: null, error: 'quota' }).status).toBe('FAILED');
    expect(videoStepFromJob({ status: 'CANCELLED', outputKey: null }).status).toBe('FAILED');
    expect(videoStepFromJob({ status: 'SUCCEEDED', outputKey: null }).status).toBe('FAILED');
    expect(videoStepFromJob({ status: 'RUNNING', outputKey: null }).status).toBe('WAITING');
    expect(videoStepFromJob({ status: 'SUCCEEDED', outputKey: 'k' }).status).toBe('DONE');
  });
  it('a failed video leaves the run partial, not succeeded', () => {
    expect(runStatusFromSteps({ generate: { status: 'DONE' }, video: { status: 'FAILED' } }, true)).toBe('PARTIAL');
    expect(runStatusFromSteps({ video: { status: 'WAITING' } }, false)).toBe('WAITING');
  });
});

describe('planSlots and normalizeConfig', () => {
  it('converts preferred local times to UTC', () => {
    const [slot] = planSlots({ date: '2026-07-01', times: ['09:00'], count: 1, timeZone: 'Europe/Amsterdam', now: new Date('2026-07-01T00:00:00Z') });
    expect(slot.toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });
  it('rejects a bad time zone', () => {
    expect(normalizeConfig({ timeOfDay: '09:00', timeZone: 'Mars/Base', postsPerDay: 1 }, 'PROJECT').ok).toBe(false);
  });
});

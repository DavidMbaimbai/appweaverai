import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  settings: [] as Row[],
  activities: [] as Row[],
  switches: [] as Row[],
  seq: 0,
}));

vi.mock('@/lib/prisma', () => {
  const match = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
      if (v && typeof v === 'object' && 'not' in (v as object)) return row[k] !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'gte' in (v as object)) return true;
      return row[k] === v;
    });
  return {
    prisma: {
      agentKillSwitch: {
        findUnique: async ({ where }: { where: { scope: string } }) => db.switches.find((s) => s.scope === where.scope) ?? null,
        findMany: async ({ where }: { where: { paused: boolean } }) => db.switches.filter((s) => s.paused === where.paused),
      },
      agentSetting: {
        findUnique: async ({ where }: { where: { scopeType_scopeId_agent: Record<string, string> } }) => {
          const k = where.scopeType_scopeId_agent;
          return db.settings.find((s) => s.scopeType === k.scopeType && s.scopeId === k.scopeId && s.agent === k.agent) ?? null;
        },
      },
      agentActivity: {
        count: async ({ where }: { where: Record<string, unknown> }) => db.activities.filter((a) => match(a, where)).length,
        aggregate: async ({ where }: { where: Record<string, unknown> }) => ({
          _sum: { costCents: db.activities.filter((a) => match(a, where)).reduce((n, a) => n + ((a.costCents as number) ?? 0), 0) },
        }),
        findUnique: async ({ where }: { where: Record<string, string> }) =>
          db.activities.find((a) => Object.entries(where).every(([k, v]) => a[k] === v)) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `act${++db.seq}`, costCents: 0, resultSummary: null, error: null, ...data } as Row;
          db.activities.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = db.activities.find((a) => a.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = db.activities.filter((a) => match(a, where));
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      },
    },
  };
});

import { approveActivity, pauseActivity, rejectActivity, retryActivity } from '@/lib/agents/decisions';
import { registerAgentExecutor } from '@/lib/agents/executors';
import { runAgentAction } from '@/lib/agents/run';

const scope = { type: 'PROJECT', projectId: 'p1' } as const;
const setting = (over: Record<string, unknown> = {}) =>
  db.settings.push({ id: 's', scopeType: 'PROJECT', scopeId: 'p1', agent: 'SOCIAL_MANAGER', mode: 'AUTONOMOUS', enabled: true, paused: false, categories: ['social_post'], dailyActionLimit: 2, dailyBudgetCents: 100, ...over });
const base = { scope, agent: 'SOCIAL_MANAGER', category: 'social_post', action: 'social.post' } as const;

beforeEach(() => {
  db.settings.length = 0;
  db.activities.length = 0;
  db.switches.length = 0;
  db.seq = 0;
});

describe('runAgentAction', () => {
  it('blocks and logs when the agent is disabled (default)', async () => {
    const result = await runAgentAction({ ...base, execute: vi.fn() });
    expect(result.status).toBe('BLOCKED');
    expect(db.activities).toHaveLength(1);
  });

  it('executes autonomous low-risk actions and records DONE with a redacted input', async () => {
    setting();
    const execute = vi.fn().mockResolvedValue({ summary: 'posted', costCents: 5 });
    const result = await runAgentAction({ ...base, input: 'to bob@example.com', execute });
    expect(result.status).toBe('DONE');
    expect(execute).toHaveBeenCalledOnce();
    expect(db.activities[0].inputSummary).toBe('to [redacted-email]');
    expect(db.activities[0].costCents).toBe(5);
  });

  it('records FAILED when the executor throws', async () => {
    setting();
    const result = await runAgentAction({ ...base, execute: async () => { throw new Error('boom'); } });
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('boom');
  });

  it('queues high-risk actions for approval even in autonomous mode', async () => {
    setting();
    const execute = vi.fn();
    const result = await runAgentAction({ ...base, kinds: ['paid_spend'], execute });
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(execute).not.toHaveBeenCalled();
  });

  it('enforces the daily action limit', async () => {
    setting();
    await runAgentAction({ ...base, execute: async () => ({ summary: 'a' }) });
    await runAgentAction({ ...base, execute: async () => ({ summary: 'b' }) });
    const third = await runAgentAction({ ...base, execute: vi.fn() });
    expect(third.status).toBe('BLOCKED');
    expect(third.reason).toMatch(/limit/);
  });

  it('blocks everything under the global kill switch', async () => {
    setting();
    db.switches.push({ id: 'g', scope: 'GLOBAL', paused: true });
    const execute = vi.fn();
    expect((await runAgentAction({ ...base, execute })).status).toBe('BLOCKED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('is idempotent per key', async () => {
    setting();
    const execute = vi.fn().mockResolvedValue({ summary: 'ok' });
    await runAgentAction({ ...base, idempotencyKey: 'k1', execute });
    const again = await runAgentAction({ ...base, idempotencyKey: 'k1', execute });
    expect(again.duplicate).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(db.activities).toHaveLength(1);
  });
});

describe('approve / reject / retry / pause', () => {
  it('runs the registered executor only after approval', async () => {
    setting({ mode: 'APPROVAL' });
    const exec = vi.fn().mockResolvedValue({ summary: 'sent' });
    registerAgentExecutor('social.post', exec);
    const queued = await runAgentAction({ ...base, payload: { id: 1 } });
    expect(queued.status).toBe('AWAITING_APPROVAL');
    expect(exec).not.toHaveBeenCalled();
    const approved = await approveActivity(queued.activityId, 'u1', scope);
    expect(approved.ok && approved.executed).toBe(true);
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: 1 } }));
    expect(db.activities[0].status).toBe('DONE');
    expect(db.activities[0].decidedBy).toBe('u1');
  });

  it('refuses to approve in another scope or while paused', async () => {
    setting({ mode: 'APPROVAL' });
    const queued = await runAgentAction({ ...base });
    expect((await approveActivity(queued.activityId, 'u1', { type: 'PROJECT', projectId: 'other' })).ok).toBe(false);
    db.settings[0].paused = true;
    expect((await approveActivity(queued.activityId, 'u1', scope)).ok).toBe(false);
  });

  it('rejects, pauses and retries', async () => {
    setting({ mode: 'APPROVAL' });
    const a = await runAgentAction({ ...base });
    expect((await rejectActivity(a.activityId, 'u1', scope)).ok).toBe(true);
    expect(db.activities[0].status).toBe('BLOCKED');
    expect((await rejectActivity(a.activityId, 'u1', scope)).ok).toBe(false);
    const retried = await retryActivity(a.activityId, scope);
    expect(retried.ok).toBe(true);
    expect(db.activities[1].retryOf).toBe(a.activityId);
    expect((await pauseActivity(db.activities[1].id, 'u1', scope)).ok).toBe(true);
  });
});

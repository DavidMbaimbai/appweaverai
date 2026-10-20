import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const store = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  seq: 0,
}));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/team/spend', () => ({ attributeAndCheckMember: vi.fn(async () => ({ ok: true })) }));

vi.mock('@/lib/prisma', () => {
  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        return Object.entries(cond as Row).every(([op, arg]) => {
          if (op === 'gte') return value >= arg;
          if (op === 'gt') return value > arg;
          if (op === 'lt') return value < arg;
          if (op === 'lte') return value <= arg;
          if (op === 'in') return (arg as unknown[]).includes(value);
          if (op === 'not') return value !== arg;
          if (op === 'startsWith') return String(value).startsWith(String(arg));
          return true;
        });
      }
      return value === cond;
    });
  };
  const apply = (row: Row, data: Row) => {
    for (const [key, val] of Object.entries(data)) {
      if (val !== null && typeof val === 'object' && !(val instanceof Date) && ('increment' in val || 'decrement' in val)) {
        row[key] = (row[key] ?? 0) + (val.increment ?? 0) - (val.decrement ?? 0);
      } else row[key] = val;
    }
  };
  const table = (name: string, unique: string[]) => {
    const rows = () => (store.tables[name] ??= []);
    const uniqueHit = (data: Row) =>
      rows().some((r) => unique.some((u) => data[u] != null && r[u] === data[u]));
    const t = {
      findUnique: async ({ where }: { where: Row }) => rows().find((r) => matches(r, where)) ?? null,
      findFirst: async ({ where }: { where?: Row } = {}) => rows().find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)),
      count: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)).length,
      create: async ({ data }: { data: Row }) => {
        if (uniqueHit(data)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const defaults: Row =
          name === 'marketingWallet'
            ? { available: 0, reserved: 0 }
            : name === 'marketingReservation'
              ? { status: 'RESERVED', settledCredits: null }
              : {};
        const row = { id: `${name}-${++store.seq}`, createdAt: new Date(), ...defaults, ...data };
        rows().push(row);
        return row;
      },
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of data) {
          if (skipDuplicates && uniqueHit(d)) continue;
          await t.create({ data: d });
          count += 1;
        }
        return { count };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (!row) throw new Error('not found');
        apply(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = rows().filter((r) => matches(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const all = rows();
        const keep = all.filter((r) => !matches(r, where));
        const count = all.length - keep.length;
        all.splice(0, all.length, ...keep);
        return { count };
      },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (row) {
          apply(row, update);
          return row;
        }
        return t.create({ data: create });
      },
      aggregate: async ({ where, _sum }: { where?: Row; _sum: Row }) => {
        const hit = rows().filter((r) => matches(r, where));
        const out: Row = {};
        for (const key of Object.keys(_sum)) out[key] = hit.length ? hit.reduce((s, r) => s + (r[key] ?? 0), 0) : null;
        return { _sum: out };
      },
    };
    return t;
  };

  const prisma = {
    marketingWallet: table('marketingWallet', ['userId']),
    marketingReservation: table('marketingReservation', ['idempotencyKey']),
    marketingLedger: table('marketingLedger', ['idempotencyKey']),
    marketingCreditLot: table('marketingCreditLot', []),
    marketingOrgControl: table('marketingOrgControl', ['orgId']),
    marketingProjectBudget: table('marketingProjectBudget', ['projectId']),
    marketingPriceItem: table('marketingPriceItem', []),
    marketingPurchase: table('marketingPurchase', ['stripeSessionId', 'paymentIntentId']),
    internalMarketingCost: table('internalMarketingCost', []),
    adminSetting: table('adminSetting', ['key']),
    marketingPackage: table('marketingPackage', []),
    user: table('user', ['id']),
    project: {
      findUnique: async ({ where, select }: { where: { id: string }; select: Row }) => {
        const project = (store.tables.project ?? []).find((p) => p.id === where.id);
        if (!project) return null;
        const ws = (store.tables.workspace ?? []).find((w) => w.id === project.workspaceId)!;
        const uid = select.workspace.select.members.where.userId as string;
        return {
          createdById: project.createdById,
          workspaceId: project.workspaceId,
          members: [],
          workspace: { ownerId: ws.ownerId, members: ws.members.includes(uid) ? [{ userId: uid }] : [] },
        };
      },
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const snapshot = JSON.stringify(store.tables, (_k, v) => v);
      const raw = Object.fromEntries(Object.entries(store.tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
      try {
        return await fn(prisma);
      } catch (error) {
        void snapshot;
        store.tables = raw;
        throw error;
      }
    },
  };
  return { prisma };
});

import { decideBilling, resolveBillingContext } from './billing-class';
import { evaluateBudget, scheduleSlotKey } from './budget';
import { DEFAULT_MARKETING_PRICES, pickActivePrices, quoteWith, type PriceRow } from './pricing';
import { grantPurchase } from './purchase';
import { detectAnomalies, NOT_AVAILABLE, summarizeReport } from './reports';
import { finishScheduledSlot, holdScheduledSlot, settleMarketingUsage, withMarketingCredits } from './run';
import { withScopeMarketing } from './system';
import { approveCatalogue, catalogueFingerprint, ensureTrialAllowance, getApproval, purchasesAllowed } from './settings';
import { grantCredits, refundReservation, reserveCredits } from './wallet';

const t = () => store.tables;
const wallet = (userId: string) => t().marketingWallet?.find((w) => w.userId === userId);

async function fund(userId: string, amount: number) {
  await grantCredits({ userId, amount, source: 'PURCHASED', kind: 'PURCHASE', idempotencyKey: `seed:${userId}` });
}

beforeEach(() => {
  store.tables = {
    user: [
      { id: 'c1', adminRole: null, subscriptionPlan: 'pro', email: 'c1@example.com' },
      { id: 'c2', adminRole: null, subscriptionPlan: 'pro', email: 'c2@example.com' },
      { id: 'admin', adminRole: 'ADMIN', subscriptionPlan: 'free', email: 'a@example.com' },
      { id: 'admin2', adminRole: 'ADMIN', subscriptionPlan: 'free', email: 'b@example.com' },
    ],
    workspace: [
      { id: 'w1', ownerId: 'c1', members: [] },
      { id: 'w2', ownerId: 'c2', members: [] },
    ],
    project: [
      { id: 'p1', workspaceId: 'w1', createdById: 'c1' },
      { id: 'p2', workspaceId: 'w2', createdById: 'c2' },
    ],
  };
  store.seq = 0;
  process.env.PLATFORM_ADMIN_USER_IDS = 'admin';
  delete process.env.PLATFORM_WORKSPACE_IDS;
  delete process.env.MARKETING_CREDITS_ENABLED;
});

describe('classification', () => {
  it('only treats admin + platform scope as internal', () => {
    const env = { PLATFORM_ADMIN_USER_IDS: 'admin' } as unknown as NodeJS.ProcessEnv;
    expect(decideBilling({ userId: 'admin', hasAdminRole: true, env })).toBe('APPWEAVER_INTERNAL');
    expect(decideBilling({ userId: 'admin', hasAdminRole: false, env })).toBe('CUSTOMER_MARKETING');
    expect(decideBilling({ userId: 'x', hasAdminRole: true, env })).toBe('CUSTOMER_MARKETING');
    const ws = { PLATFORM_WORKSPACE_IDS: 'house' } as unknown as NodeJS.ProcessEnv;
    expect(decideBilling({ userId: 'x', hasAdminRole: true, workspaceId: 'house', env: ws })).toBe('APPWEAVER_INTERNAL');
    expect(decideBilling({ userId: 'x', hasAdminRole: false, workspaceId: 'house', env: ws })).toBe('CUSTOMER_MARKETING');
  });

  it('rejects a spoofed internal claim from a customer or non-platform admin', async () => {
    const fn = vi.fn(async () => 'x');
    for (const userId of ['c1', 'admin2']) {
      const result = await withMarketingCredits(
        { userId, operation: 'text_post', claimedBilling: 'APPWEAVER_INTERNAL' },
        fn,
      );
      expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
    }
    expect(fn).not.toHaveBeenCalled();
    expect(t().internalMarketingCost ?? []).toHaveLength(0);
  });
});

describe('internal vs customer charging', () => {
  it('charges zero customer credits for platform runs and logs internal cost', async () => {
    await fund('c1', 100);
    const result = await withMarketingCredits({ userId: 'admin', operation: 'image' }, async () => 'img');
    expect(result).toMatchObject({ ok: true, charged: 0, billing: 'APPWEAVER_INTERNAL' });
    expect(t().internalMarketingCost).toHaveLength(1);
    expect(t().internalMarketingCost[0]).toMatchObject({ operation: 'image', estimatedCostCents: 4 });
    expect(wallet('admin')).toBeUndefined();
    expect(wallet('c1')).toMatchObject({ available: 100 });
  });

  it('charges the quoted credits to the customer and records an immutable settle row', async () => {
    await fund('c1', 100);
    const result = await withMarketingCredits({ userId: 'c1', operation: 'text_post' }, async () => 'post');
    expect(result).toMatchObject({ ok: true, charged: 3, billing: 'CUSTOMER_MARKETING' });
    expect(wallet('c1')).toMatchObject({ available: 97, reserved: 0 });
    expect(t().marketingLedger.find((r) => r.kind === 'SETTLE')).toMatchObject({ delta: -3, balanceAfter: 97 });
  });

  it('does not start work when the balance is too low and explains what is still possible', async () => {
    await fund('c1', 2);
    const fn = vi.fn(async () => 'x');
    const result = await withMarketingCredits({ userId: 'c1', operation: 'campaign_draft' }, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: 'insufficient', insufficient: true });
    if (!result.ok) {
      expect(result.error).toContain('/app/marketing-credits');
      expect(result.error).toContain('Engagement reply');
    }
    expect(wallet('c1')).toMatchObject({ available: 2, reserved: 0 });
  });

  it('refunds in full when the operation fails or throws, and never twice', async () => {
    await fund('c1', 100);
    const failed = await withMarketingCredits(
      { userId: 'c1', operation: 'ad_pack', idempotencyKey: 'k1', isFailure: (v: { ok: boolean }) => !v.ok },
      async () => ({ ok: false }),
    );
    expect(failed).toMatchObject({ ok: true, charged: 0 });
    expect(wallet('c1')).toMatchObject({ available: 100, reserved: 0 });

    await expect(
      withMarketingCredits({ userId: 'c1', operation: 'ad_pack', idempotencyKey: 'k2' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(wallet('c1')).toMatchObject({ available: 100, reserved: 0 });

    await withMarketingCredits({ userId: 'c1', operation: 'ad_pack', idempotencyKey: 'k3' }, async () => 'ok');
    expect(wallet('c1')!.available).toBe(92);
    const first = await refundReservation('k3');
    const second = await refundReservation('k3');
    expect(first).toEqual({ refunded: true, credits: 8 });
    expect(second.refunded).toBe(false);
    expect(wallet('c1')!.available).toBe(100);
  });

  it('never double-charges a retried idempotency key', async () => {
    await fund('c1', 100);
    await withMarketingCredits({ userId: 'c1', operation: 'text_post', idempotencyKey: 'same' }, async () => 1);
    const again = await withMarketingCredits({ userId: 'c1', operation: 'text_post', idempotencyKey: 'same' }, async () => 1);
    expect(again).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(wallet('c1')!.available).toBe(97);
  });
});

describe('concurrent reservations', () => {
  it('never reserves more than the balance', async () => {
    await fund('c1', 10);
    const results = await Promise.all(
      ['a', 'b', 'c'].map((key) =>
        reserveCredits({ userId: 'c1', operation: 'text_post', maxCredits: 4, idempotencyKey: key }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(wallet('c1')).toMatchObject({ available: 2, reserved: 8 });
  });
});

describe('purchases', () => {
  const purchase = {
    userId: 'c1',
    packageName: 'Starter',
    credits: 500,
    amountCents: 900,
    currency: 'usd',
    stripeSessionId: 'cs_1',
    paymentIntentId: 'pi_1',
  };

  it('grants once for a replayed webhook, even with a different session for the same payment', async () => {
    expect((await grantPurchase(purchase)).granted).toBe(true);
    expect((await grantPurchase({ ...purchase, stripeEventId: 'evt_2' })).granted).toBe(false);
    expect((await grantPurchase({ ...purchase, stripeSessionId: 'cs_other' })).granted).toBe(false);
    expect(wallet('c1')!.available).toBe(500);
    expect(t().marketingPurchase).toHaveLength(1);
  });
});

describe('budgets and scheduled jobs', () => {
  it('evaluates the first exceeded period', () => {
    expect(evaluateBudget({ dayLimit: 5 }, { day: 3, week: 3, month: 3 }, 3)).toBe('day');
    expect(evaluateBudget({ dayLimit: 9, monthLimit: 4 }, { day: 3, week: 3, month: 3 }, 3)).toBe('month');
    expect(evaluateBudget({}, { day: 99, week: 99, month: 99 }, 3)).toBeNull();
  });

  it('pauses the schedule once the project limit is reached and does not run duplicates', async () => {
    await fund('c1', 100);
    t().marketingProjectBudget = [{ projectId: 'p1', dayLimit: 5, weekLimit: null, monthLimit: null, pausedAt: null }];
    const run = (slot: string) =>
      withMarketingCredits(
        { userId: 'c1', projectId: 'p1', operation: 'text_post', scheduled: true, idempotencyKey: scheduleSlotKey('s1', slot, 'text_post') },
        async () => 'done',
      );
    expect(await run('2026-01-01T09:00:00Z')).toMatchObject({ ok: true, charged: 3 });
    expect(await run('2026-01-01T09:00:00Z')).toMatchObject({ ok: false });
    const paused = await run('2026-01-02T09:00:00Z');
    expect(paused).toMatchObject({ ok: false, reason: 'budget' });
    expect(t().marketingProjectBudget[0].pausedAt).toBeInstanceOf(Date);
    expect(wallet('c1')!.available).toBe(97);
    expect(await run('2026-01-03T09:00:00Z')).toMatchObject({ ok: false, reason: 'budget' });
  });
});

describe('messaging, voice and recurring-job metering', () => {
  it('retryable keys: a refunded attempt may retry, a settled one never double-charges', async () => {
    await fund('c1', 100);
    const send = (ok: boolean) =>
      withMarketingCredits(
        { userId: 'c1', operation: 'sms', params: { units: 1 }, retryable: true, idempotencyKey: 'msg:d1', isFailure: () => !ok },
        async () => ok,
      );
    await send(false);
    expect(wallet('c1')).toMatchObject({ available: 100, reserved: 0 });
    const retried = await send(true);
    expect(retried).toMatchObject({ ok: true });
    const spent = 100 - wallet('c1')!.available;
    expect(spent).toBeGreaterThan(0);
    expect(await send(true)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(100 - wallet('c1')!.available).toBe(spent);
  });

  it('does not send when credits are insufficient', async () => {
    const fn = vi.fn(async () => 'sent');
    const out = await withMarketingCredits({ userId: 'c1', operation: 'sms', params: { units: 1 }, idempotencyKey: 'msg:d2' }, fn);
    expect(out).toMatchObject({ ok: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('voice: holds an estimate then settles on actual minutes, refunding when not answered', async () => {
    await fund('c1', 100);
    const hold = await withMarketingCredits(
      { userId: 'c1', operation: 'voice_minute', params: { units: 5 }, hold: true, idempotencyKey: 'voice:c1' },
      async () => 'sid',
    );
    expect(hold).toMatchObject({ ok: true });
    expect(wallet('c1')!.reserved).toBeGreaterThan(0);
    await settleMarketingUsage('voice:c1', 'voice_minute', { units: 2 });
    expect(wallet('c1')!.reserved).toBe(0);
    const twoMinutes = 100 - wallet('c1')!.available;

    await withMarketingCredits({ userId: 'c1', operation: 'voice_minute', params: { units: 5 }, hold: true, idempotencyKey: 'voice:c2' }, async () => 'sid');
    await refundReservation('voice:c2');
    expect(100 - wallet('c1')!.available).toBe(twoMinutes);
  });

  it('platform scope charges no customer credits', async () => {
    const out = await withScopeMarketing({ scope: { type: 'PLATFORM' }, operation: 'engagement_reply', idempotencyKey: 'x' }, async () => 'ok');
    expect(out).toMatchObject({ ok: true, charged: 0 });
    expect(t().marketingWallet ?? []).toHaveLength(0);
  });

  it('recurring slots pause at the limit, are deduped per slot, and refund when the job fails', async () => {
    await fund('c1', 100);
    t().marketingPriceItem = [
      { operation: 'lead_reminder', billable: true, creditCost: 2, version: 9, effectiveFrom: new Date(0), name: 'x', description: '', rule: null, provider: null, model: null, costCents: null, maxFactor: 1, planRestrictions: [], maxPerPeriod: null },
    ];
    t().marketingProjectBudget = [{ projectId: 'p1', dayLimit: 2, weekLimit: null, monthLimit: null, pausedAt: null }];
    const args = (slot: string) => ({ userId: 'c1', projectId: 'p1', operation: 'lead_reminder' as const, slot, jobId: 'j1' });
    const first = await holdScheduledSlot(args('s1'));
    expect(first).toMatchObject({ ok: true });
    if (first.ok) await finishScheduledSlot(first.key, 'lead_reminder', true);
    expect(await holdScheduledSlot(args('s1'))).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(await holdScheduledSlot(args('s2'))).toMatchObject({ ok: false, reason: 'budget' });
    expect(t().marketingProjectBudget[0].pausedAt).toBeInstanceOf(Date);

    t().marketingProjectBudget[0].dayLimit = null;
    const resumed = await holdScheduledSlot(args('s3'));
    expect(resumed).toMatchObject({ ok: true });
    if (resumed.ok) await finishScheduledSlot(resumed.key, 'lead_reminder', false);
    expect(wallet('c1')!.reserved).toBe(0);
  });
});

describe('free-plan trial allowance and catalogue approval', () => {
  beforeEach(() => {
    t().user.push({ id: 'f1', adminRole: null, subscriptionPlan: 'free', email: 'f1@example.com' });
    t().workspace.push({ id: 'wf', ownerId: 'f1', members: [] });
    delete process.env.FREE_PLAN_MARKETING_CREDITS;
    delete process.env.MARKETING_CREDITS_ALLOW_UNAPPROVED;
  });

  it('is disabled by default', async () => {
    expect(await ensureTrialAllowance({ userId: 'f1', plan: 'free' })).toMatchObject({ granted: false, reason: 'disabled' });
    expect(wallet('f1')).toBeUndefined();
  });

  it('grants promotional credits once per user, never to paid plans', async () => {
    const env = { FREE_PLAN_MARKETING_CREDITS: '20' } as unknown as NodeJS.ProcessEnv;
    expect(await ensureTrialAllowance({ userId: 'f1', plan: 'free', env })).toMatchObject({ granted: true });
    expect(await ensureTrialAllowance({ userId: 'f1', plan: 'free', env })).toMatchObject({ granted: false, reason: 'already_granted' });
    expect(await ensureTrialAllowance({ userId: 'c1', plan: 'pro', env })).toMatchObject({ granted: false, reason: 'not_free_plan' });
    expect(wallet('f1')!.available).toBe(20);
    expect(t().marketingCreditLot[0]).toMatchObject({ source: 'PROMO' });
    expect(t().marketingCreditLot[0].expiresAt).toBeInstanceOf(Date);
  });

  it('monthly mode grants again in a new month only', async () => {
    const env = { FREE_PLAN_MARKETING_CREDITS: '5', FREE_PLAN_MARKETING_CREDITS_MODE: 'MONTHLY' } as unknown as NodeJS.ProcessEnv;
    const jan = new Date('2026-01-10T00:00:00Z');
    await ensureTrialAllowance({ userId: 'f1', plan: 'free', env, now: jan });
    await ensureTrialAllowance({ userId: 'f1', plan: 'free', env, now: new Date('2026-01-20T00:00:00Z') });
    await ensureTrialAllowance({ userId: 'f1', plan: 'free', env, now: new Date('2026-02-01T00:00:00Z') });
    expect(wallet('f1')!.available).toBe(10);
  });

  it('is applied to a free customer running a billable op but never to internal scope', async () => {
    process.env.FREE_PLAN_MARKETING_CREDITS = '10';
    const customer = await withMarketingCredits({ userId: 'f1', projectId: undefined, operation: 'text_post', idempotencyKey: 'fp1' }, async () => 'ok');
    expect(customer).toMatchObject({ ok: true, charged: 3 });
    expect(wallet('f1')!.available).toBe(7);
    const internal = await withMarketingCredits({ userId: 'admin', operation: 'text_post', idempotencyKey: 'fp2' }, async () => 'ok');
    expect(internal).toMatchObject({ ok: true, charged: 0, billing: 'APPWEAVER_INTERNAL' });
    expect(wallet('admin')).toBeUndefined();
  });

  it('blocks package purchases until the current catalogue is approved, and a change voids approval', async () => {
    t().marketingPriceItem = [{ operation: 'text_post', version: 1 }];
    t().marketingPackage = [{ id: 'pk1', credits: 500, priceCents: 900, active: true }];
    expect(await purchasesAllowed()).toBe(false);
    await approveCatalogue({ id: 'admin', email: 'a@example.com' });
    expect(await purchasesAllowed()).toBe(true);
    expect((await getApproval()).approval).toMatchObject({ approvedById: 'admin' });
    t().marketingPriceItem.push({ operation: 'text_post', version: 2 });
    expect(await purchasesAllowed()).toBe(false);
    expect(await purchasesAllowed({ MARKETING_CREDITS_ALLOW_UNAPPROVED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('fingerprint ignores inactive packages and older versions', () => {
    const a = catalogueFingerprint([{ operation: 'x', version: 2 }], [{ id: 'p', credits: 1, priceCents: 1, active: true }]);
    const b = catalogueFingerprint(
      [{ operation: 'x', version: 1 }, { operation: 'x', version: 2 }],
      [{ id: 'p', credits: 1, priceCents: 1, active: true }, { id: 'q', credits: 9, priceCents: 9, active: false }],
    );
    expect(a).toBe(b);
  });
});

describe('organisation isolation', () => {
  it('keeps wallets and ledger rows per organisation and denies cross-org projects', async () => {
    await fund('c1', 50);
    await fund('c2', 50);
    await withMarketingCredits({ userId: 'c1', projectId: 'p1', operation: 'text_post' }, async () => 1);
    expect(wallet('c1')!.available).toBe(47);
    expect(wallet('c2')!.available).toBe(50);
    expect(t().marketingLedger.find((r) => r.kind === 'SETTLE')).toMatchObject({ orgId: 'w1', userId: 'c1' });

    const fn = vi.fn(async () => 1);
    const result = await withMarketingCredits({ userId: 'c1', projectId: 'p2', operation: 'text_post' }, fn);
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(fn).not.toHaveBeenCalled();
    await expect(resolveBillingContext({ userId: 'c2', projectId: 'p2' })).resolves.toMatchObject({ orgId: 'w2', walletUserId: 'c2' });
  });

  it('blocks a suspended organisation before reserving anything', async () => {
    await fund('c1', 50);
    t().marketingOrgControl = [{ orgId: 'w1', suspendedAt: new Date(), suspendedReason: 'abuse', monthlyLimit: null }];
    const fn = vi.fn(async () => 1);
    expect(await withMarketingCredits({ userId: 'c1', projectId: 'p1', operation: 'text_post' }, fn)).toMatchObject({ reason: 'suspended' });
    expect(fn).not.toHaveBeenCalled();
    expect(wallet('c1')!.available).toBe(50);
  });
});

describe('pricing catalogue', () => {
  const prices = pickActivePrices([]);

  it('quotes estimate and max charge, with passthrough headroom and free scheduling', () => {
    const video = quoteWith(prices, 'video_per_second', { seconds: 6 });
    expect(video.credits).toBe(video.maxCredits);
    expect(video.credits % 6).toBe(0);
    const sms = quoteWith(prices, 'sms', { units: 100 });
    expect(sms.maxCredits).toBeGreaterThan(sms.credits);
    expect(quoteWith(prices, 'schedule_post')).toMatchObject({ billable: false, credits: 0, maxCredits: 0 });
    expect(quoteWith(prices, 'publish_post').estimate).toContain('free');
  });

  it('uses the newest effective version and ignores future ones', () => {
    const base = DEFAULT_MARKETING_PRICES.find((p) => p.operation === 'text_post')!;
    const row = (version: number, creditCost: number, effectiveFrom: Date): PriceRow => ({
      operation: 'text_post', version, name: base.name, description: '', creditCost, rule: null, provider: null,
      model: null, costCents: null, maxFactor: 1, planRestrictions: [], billable: true, maxPerPeriod: null, effectiveFrom,
    });
    const now = new Date('2026-06-01T00:00:00Z');
    const active = pickActivePrices(
      [row(1, 3, new Date('2026-01-01')), row(2, 5, new Date('2026-05-01')), row(3, 9, new Date('2026-07-01'))],
      now,
    );
    expect(active.get('text_post')).toMatchObject({ version: 2, creditCost: 5 });
  });
});

describe('reports', () => {
  const prices = pickActivePrices([]);
  const at = new Date();

  it('sums purchased, consumed, refunded, revenue, cost and margin', () => {
    const summary = summarizeReport({
      ledger: [
        { orgId: 'w1', kind: 'PURCHASE', delta: 500, operation: null, createdAt: at },
        { orgId: 'w1', kind: 'SETTLE', delta: -30, operation: 'text_post', createdAt: at },
        { orgId: 'w2', kind: 'SETTLE', delta: -10, operation: 'text_post', createdAt: at },
        { orgId: 'w1', kind: 'REFUND', delta: 8, operation: 'ad_pack', createdAt: at },
        { orgId: 'w1', kind: 'RELEASE', delta: 0, operation: 'image', createdAt: at },
      ],
      purchases: [{ amountCents: 1000, credits: 500 }],
      internal: [{ operation: 'image', provider: 'bedrock', estimatedCostCents: 4, actualCostCents: null }],
      prices,
    });
    expect(summary).toMatchObject({ purchasedCredits: 500, consumedCredits: 40, refundedCredits: 8, failedOperations: 2 });
    expect(summary.byOrg[0]).toEqual({ orgId: 'w1', consumed: 30 });
    expect(summary.consumedRevenueCents).toBe(80);
    expect(summary.providerCostCents).toBeCloseTo(7, 0);
    expect(summary.grossMarginCents).toBe(80 - (summary.providerCostCents as number));
    expect(summary.internal.totalActualCents).toBe(4);
  });

  it('reports margin as not available without cost or revenue data', () => {
    const summary = summarizeReport({
      ledger: [{ orgId: 'w1', kind: 'SETTLE', delta: -5, operation: 'unknown_op', createdAt: at }],
      purchases: [],
      internal: [],
      prices,
    });
    expect(summary.providerCostCents).toBe(NOT_AVAILABLE);
    expect(summary.grossMarginCents).toBe(NOT_AVAILABLE);
  });

  it('flags unusual consumption only', () => {
    const flagged = detectAnomalies(
      [{ orgId: 'a', consumed: 1000 }, { orgId: 'b', consumed: 300 }, { orgId: 'c', consumed: 50 }],
      new Map([['a', 20], ['b', 100]]),
    );
    expect(flagged.map((f) => f.orgId)).toEqual(['a']);
  });
});

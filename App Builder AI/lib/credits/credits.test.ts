import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  idempotencyKey: string;
  refType: string | null;
  refId: string | null;
};

const db = vi.hoisted(() => ({
  balance: 0,
  ledger: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/prisma', () => {
  const tx = {
    user: {
      findUnique: async () => ({ creditBalance: db.balance }),
      updateMany: async ({ where, data }: { where: { creditBalance?: { gte: number } }; data: { creditBalance: { increment?: number; decrement?: number } } }) => {
        if (where.creditBalance && db.balance < where.creditBalance.gte) return { count: 0 };
        db.balance += (data.creditBalance.increment ?? 0) - (data.creditBalance.decrement ?? 0);
        return { count: 1 };
      },
      update: async ({ data }: { data: { creditBalance: { increment: number } } }) => {
        db.balance += data.creditBalance.increment;
        return { creditBalance: db.balance };
      },
    },
    creditLedger: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        (db.ledger.find((r) => r.idempotencyKey === where.idempotencyKey) as Row | undefined) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (db.ledger.some((r) => r.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        db.ledger.push({ id: String(db.ledger.length), ...data });
        return data;
      },
    },
    creditAdjustment: { create: async () => ({}) },
  };
  return {
    prisma: {
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        // Roll the fake back if the callback throws, like a real transaction.
        const snapshot = { balance: db.balance, ledger: [...db.ledger] };
        try {
          return await fn(tx);
        } catch (error) {
          db.balance = snapshot.balance;
          db.ledger = snapshot.ledger;
          throw error;
        }
      },
    },
  };
});

import { adjustCredits, chargeCredits, refundCharge } from './ledger';
import { parsePriceOverrides, quote } from './pricing';

const base = { userId: 'u1', operation: 'agent_run', reason: 'test' };

beforeEach(() => {
  db.balance = 10;
  db.ledger = [];
});

describe('chargeCredits', () => {
  it('deducts and records the balance after', async () => {
    const result = await chargeCredits({ ...base, cost: 4, idempotencyKey: 'a' });
    expect(result).toEqual({ ok: true, balanceAfter: 6, duplicate: false });
    expect(db.ledger[0]).toMatchObject({ delta: -4, balanceAfter: 6 });
  });

  it('rejects when the balance is too low and leaves it untouched', async () => {
    const result = await chargeCredits({ ...base, cost: 11, idempotencyKey: 'a' });
    expect(result).toEqual({ ok: false, code: 'INSUFFICIENT_CREDITS', balance: 10 });
    expect(db.balance).toBe(10);
    expect(db.ledger).toHaveLength(0);
  });

  it('never overdraws under concurrent charges', async () => {
    const results = await Promise.all(
      ['a', 'b', 'c'].map((key) => chargeCredits({ ...base, cost: 4, idempotencyKey: key })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(db.balance).toBe(2);
  });

  it('charges a repeated idempotency key once', async () => {
    await chargeCredits({ ...base, cost: 4, idempotencyKey: 'same' });
    const again = await chargeCredits({ ...base, cost: 4, idempotencyKey: 'same' });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(db.balance).toBe(6);
  });
});

describe('refundCharge', () => {
  it('refunds exactly once', async () => {
    await chargeCredits({ ...base, cost: 4, idempotencyKey: 'a' });
    const first = await refundCharge('a', 'failed');
    const second = await refundCharge('a', 'failed');
    expect(first).toEqual({ ok: true, refunded: 4, balanceAfter: 10 });
    expect(second).toEqual({ ok: false, reason: 'ALREADY_REFUNDED' });
    expect(db.balance).toBe(10);
  });

  it('does nothing when there was no charge', async () => {
    expect(await refundCharge('missing', 'x')).toEqual({ ok: false, reason: 'NO_CHARGE' });
    expect(db.balance).toBe(10);
  });
});

describe('adjustCredits', () => {
  it('refuses to go negative', async () => {
    expect(await adjustCredits({ userId: 'u1', delta: -11, reason: 'r', operation: 'ADJUSTMENT' })).toEqual({
      ok: false,
      code: 'NEGATIVE_BALANCE',
    });
    expect(db.balance).toBe(10);
  });

  it('grants credits and logs them', async () => {
    const result = await adjustCredits({ userId: 'u1', delta: 5, reason: 'gift', operation: 'GRANT' });
    expect(result).toEqual({ ok: true, balanceAfter: 15 });
    expect(db.ledger).toHaveLength(1);
  });
});

describe('quote', () => {
  it('prices flat operations and scales video per second', () => {
    expect(quote('agent_run', {}, {} as NodeJS.ProcessEnv).credits).toBe(25);
    const video = quote('video_per_second', { seconds: 6 }, {} as NodeJS.ProcessEnv);
    expect(video.credits).toBe(6 * 11);
    expect(video.estimate).toContain('6s');
  });

  it('applies valid CREDIT_PRICES overrides and ignores invalid ones', () => {
    const env = { CREDIT_PRICES: '{"agent_run":40,"launch_kit":-1,"bogus":3}' } as unknown as NodeJS.ProcessEnv;
    expect(quote('agent_run', {}, env).credits).toBe(40);
    expect(quote('launch_kit', {}, env).credits).toBe(20);
    expect(parsePriceOverrides('not json')).toEqual({});
  });
});

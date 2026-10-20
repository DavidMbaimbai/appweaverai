import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';

/**
 * Single entry point for every `User.creditBalance` change. Each change is
 * applied atomically together with a `CreditLedger` row, and the unique
 * `idempotencyKey` makes retries (double clicks, webhook replays, refund
 * retries) safe.
 */

type Tx = Prisma.TransactionClient;

export type ChargeInput = {
  userId: string;
  cost: number;
  operation: string;
  reason: string;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  /** Workspace the spend is attributed to, for workspace spending limits. */
  workspaceId?: string | null;
};

export type ChargeResult =
  | { ok: true; balanceAfter: number; duplicate: boolean }
  | { ok: false; code: 'INSUFFICIENT_CREDITS' | 'USER_NOT_FOUND'; balance: number };

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

async function readBalance(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
  return user?.creditBalance ?? null;
}

/** Deducts `cost` only if the balance covers it; the check and update are one statement, so races cannot overdraw. */
export async function chargeCredits(input: ChargeInput): Promise<ChargeResult> {
  const { userId, cost, operation, reason, idempotencyKey, refType, refId, workspaceId } = input;
  if (!Number.isInteger(cost) || cost < 0) throw new Error('Credit cost must be a non-negative integer.');

  try {
    return await prisma.$transaction(async (tx): Promise<ChargeResult> => {
      const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return { ok: true, balanceAfter: existing.balanceAfter, duplicate: true };

      if (cost > 0) {
        const updated = await tx.user.updateMany({
          where: { id: userId, creditBalance: { gte: cost } },
          data: { creditBalance: { decrement: cost } },
        });
        if (updated.count !== 1) {
          const balance = await readBalance(tx, userId);
          return balance === null
            ? { ok: false, code: 'USER_NOT_FOUND', balance: 0 }
            : { ok: false, code: 'INSUFFICIENT_CREDITS', balance };
        }
      }

      const balanceAfter = await readBalance(tx, userId);
      if (balanceAfter === null) return { ok: false, code: 'USER_NOT_FOUND', balance: 0 };
      await tx.creditLedger.create({
        data: {
          userId,
          delta: -cost,
          reason,
          operation,
          refType: refType ?? null,
          refId: refId ?? null,
          workspaceId: workspaceId ?? null,
          balanceAfter,
          idempotencyKey,
        },
      });
      return { ok: true, balanceAfter, duplicate: false };
    });
  } catch (error) {
    // A concurrent request with the same key won; the whole transaction rolled back, so nothing was double-charged.
    if (isUniqueViolation(error)) {
      const existing = await prisma.creditLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return { ok: true, balanceAfter: existing.balanceAfter, duplicate: true };
    }
    throw error;
  }
}

export type RefundResult =
  | { ok: true; refunded: number; balanceAfter: number }
  | { ok: false; reason: 'NO_CHARGE' | 'ALREADY_REFUNDED' };

/** Returns the credits of an earlier charge exactly once. */
export async function refundCharge(chargeKey: string, reason: string): Promise<RefundResult> {
  const refundKey = `refund:${chargeKey}`;
  try {
    return await prisma.$transaction(async (tx): Promise<RefundResult> => {
      const charge = await tx.creditLedger.findUnique({ where: { idempotencyKey: chargeKey } });
      if (!charge || charge.delta >= 0) return { ok: false, reason: 'NO_CHARGE' };
      const already = await tx.creditLedger.findUnique({ where: { idempotencyKey: refundKey } });
      if (already) return { ok: false, reason: 'ALREADY_REFUNDED' };

      const amount = -charge.delta;
      const updated = await tx.user.update({
        where: { id: charge.userId },
        data: { creditBalance: { increment: amount } },
        select: { creditBalance: true },
      });
      await tx.creditLedger.create({
        data: {
          userId: charge.userId,
          delta: amount,
          reason,
          operation: 'REFUND',
          refType: charge.refType,
          refId: charge.refId,
          workspaceId: charge.workspaceId,
          balanceAfter: updated.creditBalance,
          idempotencyKey: refundKey,
        },
      });
      return { ok: true, refunded: amount, balanceAfter: updated.creditBalance };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'ALREADY_REFUNDED' };
    throw error;
  }
}

export type AdjustInput = {
  userId: string;
  delta: number;
  reason: string;
  operation: 'GRANT' | 'ADJUSTMENT';
  /** Also writes the support-facing `CreditAdjustment` audit row (admin id, or 'system'). */
  adjustedBy?: string;
  idempotencyKey?: string;
};

export type AdjustResult =
  | { ok: true; balanceAfter: number }
  | { ok: false; code: 'NEGATIVE_BALANCE' | 'USER_NOT_FOUND' };

/** Grants or removes credits without ever leaving a negative balance. */
export async function adjustCredits(input: AdjustInput): Promise<AdjustResult> {
  const { userId, delta, reason, operation, adjustedBy } = input;
  if (!Number.isInteger(delta) || delta === 0) throw new Error('Adjustment must be a non-zero integer.');
  const idempotencyKey = input.idempotencyKey ?? `${operation.toLowerCase()}:${userId}:${randomUUID()}`;

  return prisma.$transaction(async (tx): Promise<AdjustResult> => {
    const updated = await tx.user.updateMany({
      where: delta < 0 ? { id: userId, creditBalance: { gte: -delta } } : { id: userId },
      data: { creditBalance: { increment: delta } },
    });
    if (updated.count !== 1) {
      return (await readBalance(tx, userId)) === null
        ? { ok: false, code: 'USER_NOT_FOUND' }
        : { ok: false, code: 'NEGATIVE_BALANCE' };
    }
    const balanceAfter = (await readBalance(tx, userId)) ?? 0;
    await tx.creditLedger.create({
      data: { userId, delta, reason, operation, balanceAfter, idempotencyKey, source: operation === 'GRANT' ? 'PROMOTIONAL' : 'ADJUSTMENT' },
    });
    if (adjustedBy) {
      await tx.creditAdjustment.create({ data: { userId, amount: delta, reason, adminId: adjustedBy } });
    }
    return { ok: true, balanceAfter };
  });
}

/** Sets the balance to `amount` (monthly plan reset) and records the difference. No-op when unchanged. */
export async function resetCreditBalance(userId: string, amount: number, reason: string, adjustedBy = 'system') {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
    if (!user) return null;
    const delta = amount - user.creditBalance;
    if (delta === 0) return user.creditBalance;
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: amount, lowCreditsAlertSentAt: null },
    });
    await tx.creditLedger.create({
      data: {
        userId,
        delta,
        reason,
        operation: 'GRANT',
        source: 'SUBSCRIPTION',
        balanceAfter: amount,
        idempotencyKey: `grant:${userId}:${randomUUID()}`,
      },
    });
    await tx.creditAdjustment.create({ data: { userId, amount: delta, reason, adminId: adjustedBy } });
    return amount;
  });
}

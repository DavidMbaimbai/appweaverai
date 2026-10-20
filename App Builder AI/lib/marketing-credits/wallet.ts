import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';

/**
 * Marketing wallet. Every change is one transaction that updates the wallet with a
 * conditional statement (no overspend under concurrency) and appends an immutable
 * MarketingLedger row. Unique idempotency keys make retries and replays safe.
 */

type Tx = Prisma.TransactionClient;
type Source = 'PURCHASED' | 'PROMO' | 'SUBSCRIPTION' | 'REFUND';

export const RESERVATION_TTL_MS = 30 * 60 * 1000;

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

async function totalBalance(tx: Tx, userId: string) {
  const wallet = await tx.marketingWallet.findUnique({ where: { userId } });
  return wallet ? wallet.available + wallet.reserved : 0;
}

async function ensureWallet(tx: Tx, userId: string) {
  // INSERT ... ON CONFLICT DO NOTHING: concurrent first-time callers must not abort each other's transaction.
  await tx.marketingWallet.createMany({ data: [{ userId }], skipDuplicates: true });
}

export async function getWallet(userId: string) {
  const wallet = await prisma.marketingWallet.findUnique({ where: { userId } });
  return {
    available: wallet?.available ?? 0,
    reserved: wallet?.reserved ?? 0,
    overdraftLimit: wallet?.overdraftLimit ?? 0,
    lowBalanceThreshold: wallet?.lowBalanceThreshold ?? null,
  };
}

export type GrantInput = {
  userId: string;
  amount: number;
  source: Source;
  kind?: 'PURCHASE' | 'GRANT' | 'ADJUSTMENT' | 'REFUND';
  expiresAt?: Date | null;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  orgId?: string;
  note?: string;
};

export async function grantCredits(input: GrantInput): Promise<{ granted: boolean; balanceAfter: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('Grant must be a positive integer.');
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.marketingLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { granted: false, balanceAfter: existing.balanceAfter };
      await ensureWallet(tx, input.userId);
      await tx.marketingWallet.update({
        where: { userId: input.userId },
        data: { available: { increment: input.amount }, lowBalanceAlertSentAt: null },
      });
      await tx.marketingCreditLot.create({
        data: {
          userId: input.userId,
          source: input.source,
          amount: input.amount,
          remaining: input.amount,
          expiresAt: input.expiresAt ?? null,
          refId: input.refId ?? null,
        },
      });
      const balanceAfter = await totalBalance(tx, input.userId);
      await tx.marketingLedger.create({
        data: {
          userId: input.userId,
          orgId: input.orgId ?? null,
          kind: input.kind ?? 'GRANT',
          delta: input.amount,
          source: input.source,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          note: input.note ?? null,
          balanceAfter,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { granted: true, balanceAfter };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.marketingLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { granted: false, balanceAfter: existing.balanceAfter };
    }
    throw error;
  }
}

/** Admin deduction (never below zero, never touching reserved credits). */
export async function deductCredits(input: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  note: string;
  orgId?: string;
}): Promise<{ ok: boolean; balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.marketingLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { ok: true, balanceAfter: existing.balanceAfter };
    const updated = await tx.marketingWallet.updateMany({
      where: { userId: input.userId, available: { gte: input.amount } },
      data: { available: { decrement: input.amount } },
    });
    if (updated.count !== 1) return { ok: false, balanceAfter: await totalBalance(tx, input.userId) };
    await consumeLots(tx, input.userId, input.amount);
    const balanceAfter = await totalBalance(tx, input.userId);
    await tx.marketingLedger.create({
      data: {
        userId: input.userId,
        orgId: input.orgId ?? null,
        kind: 'ADJUSTMENT',
        delta: -input.amount,
        note: input.note,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { ok: true, balanceAfter };
  });
}

/** Spends from the lots that expire soonest first, so promo credits are used before they lapse. */
async function consumeLots(tx: Tx, userId: string, amount: number) {
  if (amount <= 0) return;
  const lots = await tx.marketingCreditLot.findMany({ where: { userId, remaining: { gt: 0 } } });
  lots.sort((a, b) => {
    const ax = a.expiresAt?.getTime() ?? Infinity;
    const bx = b.expiresAt?.getTime() ?? Infinity;
    return ax - bx || a.createdAt.getTime() - b.createdAt.getTime();
  });
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    await tx.marketingCreditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: take } } });
    left -= take;
  }
}

export type ReserveInput = {
  userId: string;
  orgId?: string | null;
  projectId?: string | null;
  operation: string;
  maxCredits: number;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  ttlMs?: number;
  now?: Date;
};

export type ReserveResult =
  | { ok: true; reservationId: string; duplicate: boolean; status: string; settledCredits: number | null }
  | { ok: false; code: 'INSUFFICIENT_CREDITS'; available: number };

/** Atomically moves `maxCredits` from available to reserved. Work must not start unless this succeeds. */
export async function reserveCredits(input: ReserveInput): Promise<ReserveResult> {
  const now = input.now ?? new Date();
  const run = () =>
    prisma.$transaction(async (tx): Promise<ReserveResult> => {
      const existing = await tx.marketingReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return {
          ok: true,
          reservationId: existing.id,
          duplicate: true,
          status: existing.status,
          settledCredits: existing.settledCredits,
        };
      }
      // The reservation (idempotency key) is claimed before the wallet row is locked, so a losing duplicate
      // never holds the wallet lock while waiting on the winner (settle/release take reservation -> wallet).
      const reservation = await tx.marketingReservation.create({
        data: {
          userId: input.userId,
          orgId: input.orgId ?? null,
          projectId: input.projectId ?? null,
          operation: input.operation,
          maxCredits: input.maxCredits,
          idempotencyKey: input.idempotencyKey,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          expiresAt: new Date(now.getTime() + (input.ttlMs ?? RESERVATION_TTL_MS)),
        },
      });
      await ensureWallet(tx, input.userId);
      const wallet = await tx.marketingWallet.findUnique({ where: { userId: input.userId } });
      const overdraft = wallet?.overdraftLimit ?? 0;
      const updated = await tx.marketingWallet.updateMany({
        where: { userId: input.userId, available: { gte: input.maxCredits - overdraft } },
        data: { available: { decrement: input.maxCredits }, reserved: { increment: input.maxCredits } },
      });
      if (updated.count !== 1) {
        await tx.marketingReservation.deleteMany({ where: { id: reservation.id } });
        return { ok: false, code: 'INSUFFICIENT_CREDITS', available: wallet?.available ?? 0 };
      }
      await tx.marketingLedger.create({
        data: {
          userId: input.userId,
          orgId: input.orgId ?? null,
          projectId: input.projectId ?? null,
          kind: 'RESERVE',
          delta: 0,
          reservedDelta: input.maxCredits,
          operation: input.operation,
          reservationId: reservation.id,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          balanceAfter: await totalBalance(tx, input.userId),
          idempotencyKey: `reserve:${input.idempotencyKey}`,
        },
      });
      return { ok: true, reservationId: reservation.id, duplicate: false, status: 'RESERVED', settledCredits: null };
    });
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.marketingReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return {
          ok: true,
          reservationId: existing.id,
          duplicate: true,
          status: existing.status,
          settledCredits: existing.settledCredits,
        };
      }
    }
    throw error;
  }
}

/** Charges `actual` (capped at the reservation) and releases the unused remainder. Replays are no-ops. */
export async function settleReservation(
  idempotencyKey: string,
  actual: number,
  options: { costCents?: number } = {},
): Promise<{ settled: boolean; charged: number }> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.marketingReservation.findUnique({ where: { idempotencyKey } });
    if (!reservation) return { settled: false, charged: 0 };
    if (reservation.status !== 'RESERVED') return { settled: false, charged: reservation.settledCredits ?? 0 };
    const charged = Math.max(0, Math.min(Math.round(actual), reservation.maxCredits));
    const claimed = await tx.marketingReservation.updateMany({
      where: { id: reservation.id, status: 'RESERVED' },
      data: { status: 'SETTLED', settledCredits: charged },
    });
    if (claimed.count !== 1) return { settled: false, charged };
    await tx.marketingWallet.update({
      where: { userId: reservation.userId },
      data: {
        reserved: { decrement: reservation.maxCredits },
        available: { increment: reservation.maxCredits - charged },
      },
    });
    await consumeLots(tx, reservation.userId, charged);
    await tx.marketingLedger.create({
      data: {
        userId: reservation.userId,
        orgId: reservation.orgId,
        projectId: reservation.projectId,
        kind: 'SETTLE',
        delta: -charged,
        reservedDelta: -reservation.maxCredits,
        operation: reservation.operation,
        reservationId: reservation.id,
        refType: reservation.refType,
        refId: reservation.refId,
        costCents: options.costCents ?? null,
        balanceAfter: await totalBalance(tx, reservation.userId),
        idempotencyKey: `settle:${idempotencyKey}`,
      },
    });
    return { settled: true, charged };
  });
}

/** Returns an unsettled reservation to the wallet (failure before completion, or stale). */
export async function releaseReservation(idempotencyKey: string, note = 'Released'): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.marketingReservation.findUnique({ where: { idempotencyKey } });
    if (!reservation || reservation.status !== 'RESERVED') return false;
    const claimed = await tx.marketingReservation.updateMany({
      where: { id: reservation.id, status: 'RESERVED' },
      data: { status: 'RELEASED', settledCredits: 0 },
    });
    if (claimed.count !== 1) return false;
    await tx.marketingWallet.update({
      where: { userId: reservation.userId },
      data: { reserved: { decrement: reservation.maxCredits }, available: { increment: reservation.maxCredits } },
    });
    await tx.marketingLedger.create({
      data: {
        userId: reservation.userId,
        orgId: reservation.orgId,
        projectId: reservation.projectId,
        kind: 'RELEASE',
        delta: 0,
        reservedDelta: -reservation.maxCredits,
        operation: reservation.operation,
        reservationId: reservation.id,
        note,
        balanceAfter: await totalBalance(tx, reservation.userId),
        idempotencyKey: `release:${idempotencyKey}`,
      },
    });
    return true;
  });
}

/** Full refund of a failed operation: releases a pending reservation or returns a settled charge. Idempotent. */
export async function refundReservation(idempotencyKey: string, note = 'Refund: operation failed') {
  const released = await releaseReservation(idempotencyKey, note);
  if (released) return { refunded: true, credits: 0 };
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.marketingReservation.findUnique({ where: { idempotencyKey } });
    if (!reservation || reservation.status !== 'SETTLED') return { refunded: false, credits: 0 };
    const credits = reservation.settledCredits ?? 0;
    const claimed = await tx.marketingReservation.updateMany({
      where: { id: reservation.id, status: 'SETTLED' },
      data: { status: 'REFUNDED' },
    });
    if (claimed.count !== 1) return { refunded: false, credits: 0 };
    if (credits > 0) {
      await tx.marketingWallet.update({
        where: { userId: reservation.userId },
        data: { available: { increment: credits } },
      });
      await tx.marketingCreditLot.create({
        data: {
          userId: reservation.userId,
          source: 'REFUND',
          amount: credits,
          remaining: credits,
          refId: reservation.id,
        },
      });
    }
    await tx.marketingLedger.create({
      data: {
        userId: reservation.userId,
        orgId: reservation.orgId,
        projectId: reservation.projectId,
        kind: 'REFUND',
        delta: credits,
        operation: reservation.operation,
        reservationId: reservation.id,
        refType: reservation.refType,
        refId: reservation.refId,
        source: 'REFUND',
        note,
        balanceAfter: await totalBalance(tx, reservation.userId),
        idempotencyKey: `refund:${idempotencyKey}`,
      },
    });
    return { refunded: true, credits };
  });
}

/** Cron: releases reservations whose work never settled. */
export async function releaseStaleReservations(now = new Date()) {
  const stale = await prisma.marketingReservation.findMany({
    where: { status: 'RESERVED', expiresAt: { lt: now } },
    take: 200,
  });
  let released = 0;
  for (const r of stale) {
    if (await releaseReservation(r.idempotencyKey, 'Released: reservation expired')) released += 1;
  }
  return released;
}

/** Cron: removes expired promo/lot credits that are still unspent. */
export async function expireLots(now = new Date()) {
  const lots = await prisma.marketingCreditLot.findMany({
    where: { remaining: { gt: 0 }, expiresAt: { lte: now } },
    take: 200,
  });
  let expired = 0;
  for (const lot of lots) {
    const done = await prisma.$transaction(async (tx) => {
      const key = `expiry:${lot.id}`;
      if (await tx.marketingLedger.findUnique({ where: { idempotencyKey: key } })) return 0;
      const wallet = await tx.marketingWallet.findUnique({ where: { userId: lot.userId } });
      const amount = Math.min(lot.remaining, wallet?.available ?? 0);
      if (amount <= 0) return 0;
      const updated = await tx.marketingWallet.updateMany({
        where: { userId: lot.userId, available: { gte: amount } },
        data: { available: { decrement: amount } },
      });
      if (updated.count !== 1) return 0;
      await tx.marketingCreditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: amount } } });
      await tx.marketingLedger.create({
        data: {
          userId: lot.userId,
          kind: 'EXPIRY',
          delta: -amount,
          source: lot.source,
          refId: lot.id,
          note: 'Credits expired',
          balanceAfter: await totalBalance(tx, lot.userId),
          idempotencyKey: lot.remaining === amount ? key : `${key}:${Date.now()}`,
        },
      });
      return amount;
    });
    if (done > 0) expired += done;
  }
  return expired;
}

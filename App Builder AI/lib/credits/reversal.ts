import { prisma } from '@/lib/prisma';
import { deductCredits, grantCredits } from '@/lib/marketing-credits/wallet';

export type ReversalResult =
  | { ok: true; credits: number; balanceAfter: number; duplicate: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REVERSIBLE' | 'ALREADY_REVERSED' | 'NEGATIVE_BALANCE'; message: string };

const MESSAGES: Record<Extract<ReversalResult, { ok: false }>['code'], string> = {
  NOT_FOUND: 'Ledger entry not found.',
  NOT_REVERSIBLE: 'This entry cannot be reversed.',
  ALREADY_REVERSED: 'This entry has already been refunded or reversed.',
  NEGATIVE_BALANCE: 'Reversing this grant would leave a negative balance; the credits were already spent.',
};

const fail = (code: Extract<ReversalResult, { ok: false }>['code']): ReversalResult => ({ ok: false, code, message: MESSAGES[code] });

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export const reversalKey = (ledger: 'DEV' | 'MARKETING', entryId: string) => `reversal:${ledger}:${entryId}`;

/**
 * Refunds or reverses one development-ledger entry by appending a compensating
 * entry; the original row is never touched (the table also rejects UPDATE/DELETE).
 * A spend is returned to the customer; a grant is clawed back (never below zero).
 */
export async function reverseDevEntry(input: { entryId: string; adminId: string; reason: string }): Promise<ReversalResult> {
  const key = reversalKey('DEV', input.entryId);
  try {
    return await prisma.$transaction(async (tx): Promise<ReversalResult> => {
      const entry = await tx.creditLedger.findUnique({ where: { id: input.entryId } });
      if (!entry) return fail('NOT_FOUND');
      if (entry.delta === 0 || entry.operation === 'REFUND' || entry.idempotencyKey.startsWith('reversal:')) {
        return fail('NOT_REVERSIBLE');
      }
      const done = await tx.ledgerReversal.findUnique({ where: { ledger_entryId: { ledger: 'DEV', entryId: entry.id } } });
      if (done) return fail('ALREADY_REVERSED');
      // A failed run is refunded automatically under `refund:<charge key>`; do not pay it back twice.
      if (entry.delta < 0 && (await tx.creditLedger.findUnique({ where: { idempotencyKey: `refund:${entry.idempotencyKey}` } }))) {
        return fail('ALREADY_REVERSED');
      }

      const amount = -entry.delta;
      const updated = await tx.user.updateMany({
        where: amount < 0 ? { id: entry.userId, creditBalance: { gte: -amount } } : { id: entry.userId },
        data: { creditBalance: { increment: amount } },
      });
      if (updated.count !== 1) return fail('NEGATIVE_BALANCE');
      const user = await tx.user.findUnique({ where: { id: entry.userId }, select: { creditBalance: true } });
      const balanceAfter = user?.creditBalance ?? 0;
      await tx.creditLedger.create({
        data: {
          userId: entry.userId,
          delta: amount,
          reason: `Reversal of ${entry.operation} entry: ${input.reason}`,
          operation: amount > 0 ? 'REFUND' : 'ADJUSTMENT',
          refType: 'ledger_entry',
          refId: entry.id,
          workspaceId: entry.workspaceId,
          source: amount > 0 ? null : 'ADJUSTMENT',
          balanceAfter,
          idempotencyKey: key,
        },
      });
      await tx.ledgerReversal.create({
        data: {
          ledger: 'DEV',
          entryId: entry.id,
          userId: entry.userId,
          credits: amount,
          reason: input.reason,
          adminId: input.adminId,
          idempotencyKey: key,
        },
      });
      return { ok: true, credits: amount, balanceAfter, duplicate: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail('ALREADY_REVERSED');
    throw error;
  }
}

/** Marketing wallet equivalent. SETTLE (spend) is returned; PURCHASE/GRANT is clawed back from the available balance. */
export async function reverseMarketingEntry(input: { entryId: string; adminId: string; reason: string }): Promise<ReversalResult> {
  const entry = await prisma.marketingLedger.findUnique({ where: { id: input.entryId } });
  if (!entry) return fail('NOT_FOUND');
  const spend = entry.kind === 'SETTLE' && entry.delta < 0;
  const grant = (entry.kind === 'PURCHASE' || entry.kind === 'GRANT') && entry.delta > 0;
  if (!spend && !grant) return fail('NOT_REVERSIBLE');

  const existing = await prisma.ledgerReversal.findUnique({ where: { ledger_entryId: { ledger: 'MARKETING', entryId: entry.id } } });
  if (existing) return fail('ALREADY_REVERSED');
  if (spend && entry.reservationId) {
    const refunded = await prisma.marketingLedger.findFirst({ where: { reservationId: entry.reservationId, kind: 'REFUND' }, select: { id: true } });
    if (refunded) return fail('ALREADY_REVERSED');
  }

  const key = reversalKey('MARKETING', entry.id);
  const credits = Math.abs(entry.delta);
  let balanceAfter: number;
  if (spend) {
    const granted = await grantCredits({
      userId: entry.userId,
      amount: credits,
      source: 'REFUND',
      kind: 'REFUND',
      idempotencyKey: key,
      refType: 'ledger_entry',
      refId: entry.id,
      orgId: entry.orgId ?? undefined,
      note: `Reversal: ${input.reason}`,
    });
    balanceAfter = granted.balanceAfter;
  } else {
    const deducted = await deductCredits({
      userId: entry.userId,
      amount: credits,
      idempotencyKey: key,
      note: `Reversal of ${entry.kind.toLowerCase()}: ${input.reason}`,
      orgId: entry.orgId ?? undefined,
    });
    if (!deducted.ok) return fail('NEGATIVE_BALANCE');
    balanceAfter = deducted.balanceAfter;
  }
  await prisma.ledgerReversal.createMany({
    data: [
      {
        ledger: 'MARKETING',
        entryId: entry.id,
        userId: entry.userId,
        credits: spend ? credits : -credits,
        reason: input.reason,
        adminId: input.adminId,
        idempotencyKey: key,
      },
    ],
    skipDuplicates: true,
  });
  return { ok: true, credits: spend ? credits : -credits, balanceAfter, duplicate: false };
}

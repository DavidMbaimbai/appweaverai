/** Integer-cent maths for marketplace revenue. Platform fee is in basis points (100 bps = 1%). */

export type Split = { platformFeeCents: number; creatorShareCents: number };

/** Fee is rounded half-up to the cent; the creator gets the remainder, so the two always sum to the amount. */
export function splitSale(amountCents: number, feeBps: number): Split {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('Amount must be a non-negative integer number of cents.');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error('Fee must be between 0 and 10000 basis points.');
  const platformFeeCents = Math.floor((amountCents * feeBps + 5_000) / 10_000);
  return { platformFeeCents, creatorShareCents: amountCents - platformFeeCents };
}

/**
 * How much of the creator's earning to reverse for a refund. `refundedBeforeCents` is what was already refunded,
 * `reversedBeforeCents` what was already reversed, so repeated or overlapping webhook deliveries never over-reverse:
 * the cumulative reversal is always the creator share pro-rated to the cumulative refund, capped at the share.
 */
export function refundReversal(args: {
  amountCents: number;
  creatorShareCents: number;
  refundedBeforeCents: number;
  reversedBeforeCents: number;
  totalRefundedCents: number;
}): { reverseCents: number; refundedCents: number } {
  const refunded = Math.min(Math.max(args.totalRefundedCents, 0), args.amountCents);
  if (args.amountCents === 0 || refunded <= args.refundedBeforeCents) return { reverseCents: 0, refundedCents: Math.max(refunded, args.refundedBeforeCents) };
  const targetReversed =
    refunded === args.amountCents
      ? args.creatorShareCents
      : Math.min(args.creatorShareCents, Math.floor((refunded * args.creatorShareCents) / args.amountCents));
  return { reverseCents: Math.max(0, targetReversed - args.reversedBeforeCents), refundedCents: refunded };
}

export type LedgerLine = { kind: 'EARNING' | 'REFUND_REVERSAL' | 'PAYOUT' | 'ADJUSTMENT'; amountCents: number };

/** Balance owed to the creator: earnings and adjustments minus reversals and payouts (amounts are stored signed). */
export function ledgerBalance(lines: LedgerLine[]) {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}

export const earningKey = (orderId: string) => `earning:${orderId}`;
export const reversalKey = (orderId: string, totalRefundedCents: number) => `reversal:${orderId}:${totalRefundedCents}`;

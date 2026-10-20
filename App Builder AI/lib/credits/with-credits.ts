import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';

import { chargeCredits, refundCharge } from './ledger';
import { CREDIT_OPERATION_LABELS, quote, type CreditOperation } from './pricing';

export const CREDITS_UPGRADE_PATH = '/app/billing';

export type CreditsOutcome<T> =
  | { ok: true; value: T; charged: number }
  | { ok: false; error: string; insufficient: boolean };

type BillingFields = { subscriptionPlan: string; subscriptionStatus: string | null };

/**
 * Only active paid subscribers spend credits. Free users keep their existing
 * daily request/token caps and are never charged. Set CREDIT_CHARGING_ENABLED=false to disable charging globally.
 */
export function isCreditMetered(user: BillingFields | null | undefined) {
  if (!user || process.env.CREDIT_CHARGING_ENABLED === 'false') return false;
  return (
    user.subscriptionPlan !== 'free' &&
    (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing')
  );
}

export function insufficientCreditsMessage(operation: CreditOperation, cost: number, balance: number) {
  return `${CREDIT_OPERATION_LABELS[operation]} costs ${cost} credits but you have ${balance}. Top up or upgrade your plan at ${CREDITS_UPGRADE_PATH}.`;
}

function isRedirectError(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

export type WithCreditsOptions<T> = {
  params?: { seconds?: number };
  refType?: string;
  refId?: string;
  /** Stable key so a retried request is charged once; also lets async failures refund later. */
  idempotencyKey?: string;
  /** Return true when a resolved result represents a failed operation that must be refunded. */
  isFailure?: (value: T) => boolean;
};

/** Charges first, runs `fn`, and refunds when it throws or reports failure. */
export async function withCredits<T>(
  userId: string,
  operation: CreditOperation,
  fn: () => Promise<T>,
  options: WithCreditsOptions<T> = {},
): Promise<CreditsOutcome<T>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionPlan: true, subscriptionStatus: true },
  });
  if (!isCreditMetered(user)) return { ok: true, value: await fn(), charged: 0 };

  const { credits, estimate } = quote(operation, options.params);
  const key = options.idempotencyKey ?? `${operation}:${userId}:${randomUUID()}`;
  const charge = await chargeCredits({
    userId,
    cost: credits,
    operation,
    reason: estimate,
    idempotencyKey: key,
    refType: options.refType,
    refId: options.refId,
  });
  if (!charge.ok) {
    return {
      ok: false,
      insufficient: charge.code === 'INSUFFICIENT_CREDITS',
      error:
        charge.code === 'INSUFFICIENT_CREDITS'
          ? insufficientCreditsMessage(operation, credits, charge.balance)
          : 'Account not found.',
    };
  }

  const refund = async (why: string) => {
    await refundCharge(key, why).catch((error) => console.error('[credits] refund failed:', error));
  };

  let value: T;
  try {
    value = await fn();
  } catch (error) {
    if (!isRedirectError(error)) await refund(`Refund: ${CREDIT_OPERATION_LABELS[operation]} failed`);
    throw error;
  }
  if (options.isFailure?.(value)) await refund(`Refund: ${CREDIT_OPERATION_LABELS[operation]} failed`);
  return { ok: true, value, charged: credits };
}

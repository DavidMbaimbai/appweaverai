import { prisma } from '@/lib/prisma';

import { loadLimitStatuses } from './limits';
import { isCreditMetered } from './with-credits';
import { CREDIT_OPERATION_LABELS, quote, type CreditOperation } from './pricing';

/** Shown next to every pre-run cost so nobody reads it as a guaranteed price. */
export const ESTIMATE_DISCLAIMER = 'Estimate only: the final cost may differ. Failed runs are refunded.';

export type SpendLimitStatus = {
  scope: 'USER' | 'WORKSPACE' | 'ALLOWANCE';
  spent: number;
  cap: number;
};

export type CreditEstimate = {
  operation: CreditOperation;
  label: string;
  /** Estimated credits; 0 when this user is not charged. */
  credits: number;
  metered: boolean;
  balance: number;
  balanceAfter: number;
  /** Set when running now would exceed the balance or a spending limit. */
  blocked: null | { reason: 'INSUFFICIENT_CREDITS' | 'SPEND_LIMIT'; message: string };
  disclaimer: string;
  summary: string;
};

export type BuildEstimateInput = {
  operation: CreditOperation;
  params?: { seconds?: number };
  metered: boolean;
  balance: number;
  limits?: SpendLimitStatus[];
  env?: NodeJS.ProcessEnv;
};

/** Pure calculation, so the same numbers are used by the UI hint and by tests. */
export function buildEstimate(input: BuildEstimateInput): CreditEstimate {
  const label = CREDIT_OPERATION_LABELS[input.operation];
  const priced = quote(input.operation, input.params, input.env);
  const credits = input.metered ? priced.credits : 0;
  const balanceAfter = input.balance - credits;

  let blocked: CreditEstimate['blocked'] = null;
  if (input.metered && credits > input.balance) {
    blocked = {
      reason: 'INSUFFICIENT_CREDITS',
      message: `This needs about ${credits} credits but you have ${input.balance}. Top up or upgrade your plan.`,
    };
  } else {
    const hit = (input.limits ?? []).find((l) => l.scope !== 'ALLOWANCE' && l.spent + credits > l.cap);
    if (input.metered && hit) {
      blocked = {
        reason: 'SPEND_LIMIT',
        message: `This would pass your ${hit.scope === 'USER' ? 'personal' : 'workspace'} monthly spending limit of ${hit.cap} credits (${hit.spent} used).`,
      };
    }
  }

  return {
    operation: input.operation,
    label,
    credits,
    metered: input.metered,
    balance: input.balance,
    balanceAfter,
    blocked,
    disclaimer: ESTIMATE_DISCLAIMER,
    summary: input.metered ? `${priced.estimate} (estimate)` : `${label}: included in your plan (no credits charged)`,
  };
}

export async function estimateOperation(
  userId: string,
  operation: CreditOperation,
  options: { params?: { seconds?: number }; workspaceId?: string | null } = {},
): Promise<CreditEstimate | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true, subscriptionPlan: true, subscriptionStatus: true },
  });
  if (!user) return null;
  const limits = await loadLimitStatuses(userId, options.workspaceId ?? null);
  return buildEstimate({
    operation,
    params: options.params,
    metered: isCreditMetered(user),
    balance: user.creditBalance,
    limits,
  });
}

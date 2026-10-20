import { chargeCredits, refundCharge } from '@/lib/credits/ledger';
import { checkSpendLimits } from '@/lib/credits/limits';
import { ESTIMATE_DISCLAIMER } from '@/lib/credits/estimate';
import { isCreditMetered } from '@/lib/credits/with-credits';
import { prisma } from '@/lib/prisma';

import type { DevTeamLimits } from './types';

/** Ledger operation label for the development ledger. Deliberately not a marketing-wallet operation. */
export const DEV_TEAM_OPERATION = 'dev_team_run';

export const devTeamChargeKey = (runId: string) => `devteam:${runId}`;

export type DevTeamEstimate = {
  /** Planner + every task the plan could hold + one conflict-resolver call, capped at runCreditCap. */
  maxCredits: number;
  /** What a typical small plan costs (planner + 4 tasks). */
  typicalCredits: number;
  metered: boolean;
  balance: number;
  blocked: null | { reason: 'INSUFFICIENT_CREDITS' | 'SPEND_LIMIT'; message: string };
  disclaimer: string;
  summary: string;
};

export type EstimateInput = {
  limits: Pick<DevTeamLimits, 'maxTasks' | 'plannerCredits' | 'taskCredits' | 'resolverCredits' | 'runCreditCap'>;
  metered: boolean;
  balance: number;
  spendLimits?: Array<{ scope: 'USER' | 'WORKSPACE' | 'ALLOWANCE'; spent: number; cap: number }>;
};

/** Pure, so the UI hint, the reservation and the tests use the same numbers. All prices are placeholders. */
export function buildDevTeamEstimate(input: EstimateInput): DevTeamEstimate {
  const { limits } = input;
  const maxCredits = Math.min(limits.runCreditCap, limits.plannerCredits + limits.maxTasks * limits.taskCredits + limits.resolverCredits);
  const typicalCredits = Math.min(maxCredits, limits.plannerCredits + 4 * limits.taskCredits);
  let blocked: DevTeamEstimate['blocked'] = null;
  if (input.metered && maxCredits > input.balance) {
    blocked = { reason: 'INSUFFICIENT_CREDITS', message: `A run can use up to ${maxCredits} credits but you have ${input.balance}. Top up or upgrade your plan.` };
  } else {
    const hit = (input.spendLimits ?? []).find((l) => l.scope !== 'ALLOWANCE' && l.spent + maxCredits > l.cap);
    if (input.metered && hit) {
      blocked = {
        reason: 'SPEND_LIMIT',
        message: `A run could pass your ${hit.scope === 'USER' ? 'personal' : 'workspace'} monthly spending limit of ${hit.cap} credits (${hit.spent} used).`,
      };
    }
  }
  return {
    maxCredits,
    typicalCredits,
    metered: input.metered,
    balance: input.balance,
    blocked,
    disclaimer: ESTIMATE_DISCLAIMER,
    summary: input.metered
      ? `About ${typicalCredits} credits for a typical run, never more than ${maxCredits}. Unused credits are returned.`
      : 'Included in your plan: no credits are charged, but the same per-run budget applies.',
  };
}

export type Reservation =
  | { ok: true; reserved: number; metered: boolean; creditKey: string | null }
  | { ok: false; error: string };

/** Reserves the maximum for the run up front (one idempotent ledger charge). Unmetered users reserve nothing but keep the budget. */
export async function reserveRunCredits(args: { userId: string; workspaceId: string; runId: string; maxCredits: number }): Promise<Reservation> {
  const user = await prisma.user.findUnique({ where: { id: args.userId }, select: { subscriptionPlan: true, subscriptionStatus: true } });
  if (!isCreditMetered(user)) return { ok: true, reserved: args.maxCredits, metered: false, creditKey: null };

  const limit = await checkSpendLimits(args.userId, args.workspaceId, args.maxCredits);
  if (!limit.ok) return { ok: false, error: limit.message };

  const key = devTeamChargeKey(args.runId);
  const charge = await chargeCredits({
    userId: args.userId,
    cost: args.maxCredits,
    operation: DEV_TEAM_OPERATION,
    reason: `AI development team run (reserved up to ${args.maxCredits} credits; unused credits are returned)`,
    idempotencyKey: key,
    refType: 'DevTeamRun',
    refId: args.runId,
    workspaceId: args.workspaceId,
  });
  if (!charge.ok) {
    return {
      ok: false,
      error:
        charge.code === 'INSUFFICIENT_CREDITS'
          ? `This run needs up to ${args.maxCredits} credits but you have ${charge.balance}. Top up or upgrade your plan at /app/billing.`
          : 'Account not found.',
    };
  }
  return { ok: true, reserved: args.maxCredits, metered: true, creditKey: key };
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Settles a reservation: refunds everything on a failed run, otherwise only the unused part.
 * Uses the same `refund:<charge key>` ledger key as refundCharge, so a charge can never be refunded twice.
 */
export async function settleRunCredits(args: { creditKey: string | null; reserved: number; spent: number; failed: boolean }): Promise<{ refunded: number }> {
  if (!args.creditKey) return { refunded: 0 };
  const unused = args.failed ? args.reserved : Math.max(0, args.reserved - Math.min(args.spent, args.reserved));
  if (unused <= 0) return { refunded: 0 };
  if (unused === args.reserved) {
    const result = await refundCharge(args.creditKey, args.failed ? 'Refund: AI development team run failed' : 'Refund: unused AI development team credits');
    return { refunded: result.ok ? result.refunded : 0 };
  }

  const refundKey = `refund:${args.creditKey}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const charge = await tx.creditLedger.findUnique({ where: { idempotencyKey: args.creditKey as string } });
      if (!charge || charge.delta >= 0) return { refunded: 0 };
      if (await tx.creditLedger.findUnique({ where: { idempotencyKey: refundKey } })) return { refunded: 0 };
      const amount = Math.min(unused, -charge.delta);
      const user = await tx.user.update({ where: { id: charge.userId }, data: { creditBalance: { increment: amount } }, select: { creditBalance: true } });
      await tx.creditLedger.create({
        data: {
          userId: charge.userId,
          delta: amount,
          reason: `Refund: ${amount} unused AI development team credits`,
          operation: 'REFUND',
          refType: charge.refType,
          refId: charge.refId,
          workspaceId: charge.workspaceId,
          balanceAfter: user.creditBalance,
          idempotencyKey: refundKey,
        },
      });
      return { refunded: amount };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { refunded: 0 };
    throw error;
  }
}

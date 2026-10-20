import { randomUUID } from 'node:crypto';

import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { decideBilling, resolveBillingContext, BillingClassificationError, type CampaignBillingClass } from './billing-class';
import { evaluateBudget, periodStarts, scheduleSlotKey } from './budget';
import { recordInternalCost } from './internal-cost';
import {
  getActivePrices,
  quoteWith,
  type MarketingOperation,
  type MarketingQuote,
} from './pricing';
import { getWallet, refundReservation, releaseReservation, reserveCredits, settleReservation } from './wallet';
import { ensureTrialAllowance } from './settings';
import { attributeAndCheckMember } from '@/lib/team/spend';

export const MARKETING_CREDITS_PATH = '/app/marketing-credits';

export type MarketingFailureReason =
  | 'insufficient'
  | 'suspended'
  | 'budget'
  | 'org_limit'
  | 'member_limit'
  | 'plan'
  | 'period_limit'
  | 'duplicate'
  | 'forbidden';

export type MarketingOutcome<T> =
  | { ok: true; value: T; charged: number; billing: CampaignBillingClass; key?: string }
  | { ok: false; reason: MarketingFailureReason; error: string; insufficient: boolean };

export type WithMarketingOptions<T> = {
  userId: string;
  projectId?: string | null;
  operation: MarketingOperation;
  params?: { seconds?: number; units?: number };
  /** Stable key: retries with the same key are never charged or run twice. */
  idempotencyKey?: string;
  /** True for recurring/scheduled jobs: hitting a limit or empty wallet pauses the schedule. */
  scheduled?: boolean;
  refType?: string;
  refId?: string;
  /**
   * Client-supplied billing hint. It can never grant INTERNAL; it is only used to
   * reject spoofing attempts.
   */
  claimedBilling?: CampaignBillingClass | null;
  /** Resolved result counts as a failed operation: full refund. */
  isFailure?: (value: T) => boolean;
  /** Actual credits to charge (capped at the reserved max). Default: the quote. */
  actual?: (value: T) => number;
  /** Keep the reservation open after fn succeeds; settle with settleMarketingUsage or refundMarketingKey. */
  hold?: boolean;
  /** Retries after a failed (refunded) attempt are allowed; a pending or settled attempt is still a duplicate. */
  retryable?: boolean;
};

function isRedirectError(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

async function netSpend(where: { projectId?: string; orgId?: string }, since: Date) {
  const agg = await prisma.marketingLedger.aggregate({
    where: { ...where, kind: { in: ['SETTLE', 'REFUND'] }, createdAt: { gte: since } },
    _sum: { delta: true },
  });
  return -(agg._sum.delta ?? 0);
}

async function openReserved(where: { projectId?: string; orgId?: string }) {
  const agg = await prisma.marketingReservation.aggregate({
    where: { ...where, status: 'RESERVED' },
    _sum: { maxCredits: true },
  });
  return agg._sum.maxCredits ?? 0;
}

async function notifyOwner(userId: string, subject: string, body: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) return;
    await sendEmail({
      to: user.email,
      subject,
      text: `${body}\n\nManage marketing credits: ${MARKETING_CREDITS_PATH}`,
      html: `<p>${body}</p><p><a href="${MARKETING_CREDITS_PATH}">Manage marketing credits</a></p>`,
    });
  } catch (error) {
    console.error('[marketing-credits] notification failed:', error);
  }
}

async function pauseSchedule(projectId: string | null, ownerId: string, reason: string) {
  if (!projectId) return;
  const existing = await prisma.marketingProjectBudget.findUnique({ where: { projectId } });
  if (existing?.pausedAt) return;
  await prisma.marketingProjectBudget.upsert({
    where: { projectId },
    create: { projectId, pausedAt: new Date(), pausedReason: reason },
    update: { pausedAt: new Date(), pausedReason: reason },
  });
  await notifyOwner(ownerId, 'Marketing schedule paused', `Recurring marketing jobs were paused: ${reason}`);
}

/** One heads-up per project, period and window before a scheduled budget is used up (best-effort dedupe). */
async function warnNearLimit(
  projectId: string,
  ownerId: string,
  limits: { dayLimit: number | null; weekLimit: number | null; monthLimit: number | null },
  spent: { day: number; week: number; month: number },
  cost: number,
  starts: ReturnType<typeof periodStarts>,
) {
  const percent = Math.min(100, Math.max(1, Number(process.env.MARKETING_BUDGET_WARN_PERCENT ?? 80)));
  const periods: Array<['day' | 'week' | 'month', number | null]> = [
    ['day', limits.dayLimit],
    ['week', limits.weekLimit],
    ['month', limits.monthLimit],
  ];
  for (const [period, limit] of periods) {
    if (limit == null || limit <= 0 || ((spent[period] + cost) * 100) / limit < percent) continue;
    const gate = await rateLimit(`mkt-budget-warn:${projectId}:${period}:${starts[period].toISOString()}`, 1, 31 * 86_400_000);
    if (!gate.ok) continue;
    await notifyOwner(
      ownerId,
      'Marketing budget almost used',
      `A project's ${period} marketing budget is at ${Math.round(((spent[period] + cost) * 100) / limit)}% (${spent[period] + cost} of ${limit} credits). Scheduled jobs pause when it is reached.`,
    );
  }
}

async function stillPossibleMessage(available: number) {
  const prices = await getActivePrices();
  const possible = [...prices.values()]
    .filter((p) => p.billable && p.creditCost > 0 && p.creditCost <= available && !p.unit)
    .slice(0, 5)
    .map((p) => `${p.name} (${p.creditCost})`);
  return possible.length > 0
    ? `With your ${available} marketing credits you can still run: ${possible.join(', ')}.`
    : `You have ${available} marketing credits, not enough for any paid action.`;
}

async function maybeLowBalanceAlert(walletUserId: string) {
  const wallet = await prisma.marketingWallet.findUnique({ where: { userId: walletUserId } });
  if (!wallet || wallet.lowBalanceAlertSentAt) return;
  const threshold = wallet.lowBalanceThreshold ?? Number(process.env.MARKETING_LOW_BALANCE_THRESHOLD ?? 50);
  if (!(threshold > 0) || wallet.available > threshold) return;
  const claimed = await prisma.marketingWallet.updateMany({
    where: { userId: walletUserId, lowBalanceAlertSentAt: null },
    data: { lowBalanceAlertSentAt: new Date() },
  });
  if (claimed.count !== 1) return;
  await notifyOwner(
    walletUserId,
    'Low marketing credit balance',
    `Your marketing credit balance is ${wallet.available}, at or below your alert level of ${threshold}.`,
  );
}

/**
 * Classify -> checks -> reserve (before any work) -> run -> settle, or refund when the work fails.
 * Internal (platform) runs charge no customer credits and only log an InternalMarketingCost.
 */
export async function withMarketingCredits<T>(
  options: WithMarketingOptions<T>,
  fn: () => Promise<T>,
): Promise<MarketingOutcome<T>> {
  let ctx;
  try {
    ctx = await resolveBillingContext({
      userId: options.userId,
      projectId: options.projectId,
      claimed: options.claimedBilling,
    });
  } catch (error) {
    if (error instanceof BillingClassificationError) {
      return { ok: false, reason: 'forbidden', error: error.message, insufficient: false };
    }
    throw error;
  }

  const prices = await getActivePrices();
  const q: MarketingQuote = quoteWith(prices, options.operation, options.params);

  if (ctx.billing === 'APPWEAVER_INTERNAL') {
    const price = prices.get(options.operation);
    if (!q.billable) return { ok: true, value: await fn(), charged: 0, billing: 'APPWEAVER_INTERNAL' };
    const units = q.billable && price?.unit ? Math.max(1, Math.ceil(options.params?.seconds ?? options.params?.units ?? 1)) : 1;
    const value = await fn();
    await recordInternalCost({
      operation: options.operation,
      provider: price?.provider ?? 'unknown',
      estimatedCostCents: (price?.costCents ?? 0) * units,
      refType: options.refType,
      refId: options.refId,
      adminId: options.userId,
    });
    return { ok: true, value, charged: 0, billing: 'APPWEAVER_INTERNAL' };
  }

  const fail = (reason: MarketingFailureReason, error: string, insufficient = false): MarketingOutcome<T> => ({
    ok: false,
    reason,
    error,
    insufficient,
  });

  if (!q.billable || process.env.MARKETING_CREDITS_ENABLED === 'false') {
    return { ok: true, value: await fn(), charged: 0, billing: 'CUSTOMER_MARKETING' };
  }

  let attemptKey: string | null = null;
  if (options.idempotencyKey) {
    if (options.retryable) {
      // A refunded/released attempt may be retried under a new attempt number; a pending or settled one is a duplicate.
      const prior = await prisma.marketingReservation.findMany({
        where: { idempotencyKey: { startsWith: `${options.idempotencyKey}#` } },
        select: { status: true },
      });
      if (prior.some((r: { status: string }) => r.status === 'RESERVED' || r.status === 'SETTLED')) {
        return fail('duplicate', 'This action was already submitted.');
      }
      attemptKey = `${options.idempotencyKey}#${prior.length}`;
    } else {
      const existing = await prisma.marketingReservation.findUnique({ where: { idempotencyKey: options.idempotencyKey } });
      if (existing) return fail('duplicate', 'This action was already submitted.');
    }
  }

  const control = await prisma.marketingOrgControl.findUnique({ where: { orgId: ctx.orgId } });
  if (control?.suspendedAt) {
    return fail('suspended', `Marketing is suspended for this organisation${control.suspendedReason ? `: ${control.suspendedReason}` : ''}. Contact support.`);
  }
  // Trial allowance is only reachable here: after classification excluded internal scope.
  await ensureTrialAllowance({ userId: ctx.walletUserId, plan: ctx.plan }).catch(() => undefined);
  if (q.planRestrictions.includes(ctx.plan)) {
    return fail('plan', `${q.estimate.split(':')[0]} is not available on the ${ctx.plan} plan. Upgrade at /app/billing.`);
  }

  const starts = periodStarts();
  if (control?.monthlyLimit != null) {
    const used = (await netSpend({ orgId: ctx.orgId }, starts.month)) + (await openReserved({ orgId: ctx.orgId }));
    if (used + q.maxCredits > control.monthlyLimit) {
      return fail('org_limit', `This organisation reached its monthly marketing limit (${control.monthlyLimit} credits). Contact support to raise it.`);
    }
  }
  if (q.maxPerPeriod != null) {
    const count = await prisma.marketingLedger.count({
      where: { orgId: ctx.orgId, operation: options.operation, kind: 'SETTLE', createdAt: { gte: starts.month } },
    });
    if (count >= q.maxPerPeriod) {
      return fail('period_limit', `Monthly limit of ${q.maxPerPeriod} reached for this action.`);
    }
  }

  if (ctx.projectId) {
    const budget = await prisma.marketingProjectBudget.findUnique({ where: { projectId: ctx.projectId } });
    let spent: { day: number; week: number; month: number } | null = null;
    if (budget && (budget.dayLimit != null || budget.weekLimit != null || budget.monthLimit != null)) {
      const where = { projectId: ctx.projectId };
      const reserved = await openReserved(where);
      spent = {
        day: (await netSpend(where, starts.day)) + reserved,
        week: (await netSpend(where, starts.week)) + reserved,
        month: (await netSpend(where, starts.month)) + reserved,
      };
      const exceeded = evaluateBudget(budget, spent, q.maxCredits);
      if (exceeded) {
        const message = `The ${exceeded} marketing budget for this project is reached.`;
        if (options.scheduled) await pauseSchedule(ctx.projectId, ctx.walletUserId, message);
        return fail('budget', message);
      }
    }
    if (options.scheduled && budget?.pausedAt) {
      // Limits allow the job again (period rolled over or raised); resume only if the balance also covers it.
      const { available } = await getWallet(ctx.walletUserId);
      if (available < q.maxCredits) {
        return fail('budget', `Scheduled marketing is paused: ${budget.pausedReason ?? 'budget reached'}. Top up at ${MARKETING_CREDITS_PATH}.`);
      }
      await prisma.marketingProjectBudget.update({ where: { projectId: ctx.projectId }, data: { pausedAt: null, pausedReason: null } });
    }
    if (options.scheduled && budget && spent) await warnNearLimit(ctx.projectId, ctx.walletUserId, budget, spent, q.maxCredits, starts);
  }

  const key = attemptKey ?? options.idempotencyKey ?? `${options.operation}:${ctx.walletUserId}:${randomUUID()}`;
  const reservation = await reserveCredits({
    userId: ctx.walletUserId,
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    operation: options.operation,
    maxCredits: q.maxCredits,
    idempotencyKey: key,
    refType: options.refType,
    refId: options.refId,
  });
  if (!reservation.ok) {
    const message = `${q.estimate}, but you have ${reservation.available}. ${await stillPossibleMessage(reservation.available)} Top up at ${MARKETING_CREDITS_PATH}.`;
    if (options.scheduled) await pauseSchedule(ctx.projectId, ctx.walletUserId, 'marketing credit balance is empty');
    return fail('insufficient', message, true);
  }
  if (reservation.duplicate) return fail('duplicate', 'This action was already submitted.');
  if (ctx.projectId && ctx.orgId && !ctx.orgId.startsWith('user:')) {
    const member = await attributeAndCheckMember({
      workspaceId: ctx.orgId,
      userId: options.userId,
      projectId: ctx.projectId,
      operation: options.operation,
      ledgerKey: key,
    });
    if (!member.ok) {
      await releaseReservation(key, 'Member spending limit reached').catch((e) => console.error('[marketing-credits] release failed:', e));
      return fail('member_limit', `You reached your monthly marketing spending limit for this workspace (${member.limit} credits). Ask a workspace admin to raise it.`);
    }
  }

  let value: T;
  try {
    value = await fn();
  } catch (error) {
    if (isRedirectError(error)) {
      await settleReservation(key, q.credits);
    } else {
      await refundReservation(key).catch((e) => console.error('[marketing-credits] refund failed:', e));
    }
    throw error;
  }
  if (options.isFailure?.(value)) {
    await refundReservation(key).catch((e) => console.error('[marketing-credits] refund failed:', e));
    return { ok: true, value, charged: 0, billing: 'CUSTOMER_MARKETING' };
  }
  // Held reservations are settled later by the caller (e.g. a call's real duration).
  if (options.hold) return { ok: true, value, charged: 0, billing: 'CUSTOMER_MARKETING', key };
  const settled = await settleReservation(key, options.actual ? options.actual(value) : q.credits);
  await maybeLowBalanceAlert(ctx.walletUserId).catch(() => undefined);
  return { ok: true, value, charged: settled.charged, billing: 'CUSTOMER_MARKETING' };
}

/** For async work (video): the reservation is held until the job settles or fails. */
export async function settleMarketingKey(key: string, actual: number) {
  return settleReservation(key, actual);
}
/** Settles a held reservation for the units actually used (e.g. call minutes); never above the reserved max. */
export async function settleMarketingUsage(key: string, operation: MarketingOperation, params: { seconds?: number; units?: number }) {
  const quote = quoteWith(await getActivePrices(), operation, params);
  return settleReservation(key, quote.credits);
}
export async function refundMarketingKey(key: string, note?: string) {
  return refundReservation(key, note);
}
export async function releaseMarketingKey(key: string, note?: string) {
  return releaseReservation(key, note);
}

export type ScheduledSlot = { ok: true; key: string | null } | { ok: false; reason: string; error: string };

/**
 * For recurring jobs whose work is too intricate to wrap: checks budget and balance (pausing the schedule and notifying the
 * owner when reached) and holds the slot's reservation. The slot key makes retries and restarts duplicates, never double charges.
 * Free operations return `key: null` and cost nothing.
 */
export async function holdScheduledSlot(opts: {
  userId: string;
  projectId?: string | null;
  operation: MarketingOperation;
  slot: string;
  jobId: string;
}): Promise<ScheduledSlot> {
  const outcome = await withMarketingCredits(
    {
      userId: opts.userId,
      projectId: opts.projectId,
      operation: opts.operation,
      scheduled: true,
      retryable: true,
      hold: true,
      idempotencyKey: scheduleSlotKey(opts.jobId, opts.slot, opts.operation),
      refType: 'scheduled_job',
      refId: opts.jobId,
    },
    async () => true,
  );
  return outcome.ok ? { ok: true, key: outcome.key ?? null } : { ok: false, reason: outcome.reason, error: outcome.error };
}

/** Settles a held slot when the job succeeded, or refunds it in full when it did not. Idempotent. */
export async function finishScheduledSlot(key: string | null, operation: MarketingOperation, success: boolean) {
  if (!key) return;
  if (success) await settleMarketingUsage(key, operation, {});
  else await refundMarketingKey(key, 'Refund: scheduled job did not complete');
}

export async function getMarketingHint(userId: string, operation: MarketingOperation, params?: { seconds?: number; units?: number }) {
  const prices = await getActivePrices();
  const quote = quoteWith(prices, operation, params);
  const wallet = await getWallet(userId);
  return { quote, available: wallet.available, reserved: wallet.reserved };
}

export { decideBilling };

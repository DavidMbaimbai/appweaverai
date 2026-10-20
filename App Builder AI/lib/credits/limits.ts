import { PLAN_DEFINITIONS, resolvePlanId } from '@/lib/billing/plans';
import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';
import { prisma } from '@/lib/prisma';

import type { SpendLimitStatus } from './estimate';

/**
 * Development-credit spending limits and usage alerts. Spending is read from the
 * development `CreditLedger` only: the marketing wallet is a separate balance and
 * is never counted here.
 */

export const ALERT_THRESHOLDS = [80, 100] as const;

/** Operations that add credits; everything else on the ledger is spend (or a refund of spend). */
const NON_SPEND_OPERATIONS = ['GRANT', 'ADJUSTMENT'];

export function periodOf(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const period = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { period, start, end };
}

export function thresholdsReached(spent: number, cap: number): number[] {
  if (cap <= 0) return [];
  return ALERT_THRESHOLDS.filter((t) => spent * 100 >= cap * t);
}

/** Net credits spent this month (refunds reduce it). */
export async function monthlySpend(where: { userId?: string; workspaceId?: string }, now = new Date()) {
  const { start, end } = periodOf(now);
  const sum = await prisma.creditLedger.aggregate({
    where: {
      ...where,
      createdAt: { gte: start, lt: end },
      operation: { notIn: NON_SPEND_OPERATIONS },
    },
    _sum: { delta: true },
  });
  return Math.max(0, -(sum._sum.delta ?? 0));
}

export async function setSpendLimit(scope: 'USER' | 'WORKSPACE', scopeId: string, monthlyLimit: number | null, setById: string) {
  if (monthlyLimit === null) {
    await prisma.creditSpendLimit.deleteMany({ where: { scope, scopeId } });
    return;
  }
  if (!Number.isInteger(monthlyLimit) || monthlyLimit < 1) throw new Error('Limit must be a positive whole number.');
  await prisma.creditSpendLimit.upsert({
    where: { scope_scopeId: { scope, scopeId } },
    create: { scope, scopeId, monthlyLimit, setById },
    update: { monthlyLimit, setById },
  });
}

function limitFilter(userId: string, workspaceId: string | null) {
  return {
    OR: [{ scope: 'USER', scopeId: userId }, ...(workspaceId ? [{ scope: 'WORKSPACE', scopeId: workspaceId }] : [])],
  };
}

export async function loadLimitStatuses(userId: string, workspaceId: string | null, now = new Date()): Promise<SpendLimitStatus[]> {
  const limits = await prisma.creditSpendLimit.findMany({ where: limitFilter(userId, workspaceId) });
  const out: SpendLimitStatus[] = [];
  for (const limit of limits) {
    const spent = await monthlySpend(limit.scope === 'USER' ? { userId } : { workspaceId: limit.scopeId }, now);
    out.push({ scope: limit.scope as 'USER' | 'WORKSPACE', spent, cap: limit.monthlyLimit });
  }
  return out;
}

export type SpendCheck = { ok: true } | { ok: false; scope: 'USER' | 'WORKSPACE'; cap: number; spent: number; message: string };

/** Blocks a charge that would push monthly spend past a user or workspace limit. */
export async function checkSpendLimits(userId: string, workspaceId: string | null, cost: number, now = new Date()): Promise<SpendCheck> {
  const statuses = await loadLimitStatuses(userId, workspaceId, now);
  const hit = statuses.find((s) => s.spent + cost > s.cap);
  if (!hit || hit.scope === 'ALLOWANCE') return { ok: true };
  const who = hit.scope === 'USER' ? 'Your' : 'This workspace\u2019s';
  return {
    ok: false,
    scope: hit.scope,
    cap: hit.cap,
    spent: hit.spent,
    message: `${who} monthly development-credit spending limit of ${hit.cap} credits would be exceeded (${hit.spent} used). Raise the limit in Usage & credits to continue.`,
  };
}

function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '') ||
    'https://appweaverai.com'
  );
}

async function emailAlert(userId: string, scopeLabel: string, threshold: number, spent: number, cap: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user?.email) return false;
  const url = `${appUrl()}/app/usage`;
  const headline = threshold >= 100 ? `You have reached your ${scopeLabel}` : `You have used ${threshold}% of your ${scopeLabel}`;
  await sendEmail({
    to: user.email,
    subject: `AppWeaver AI: ${headline}`,
    html: renderBrandedEmail({
      previewText: `${spent} of ${cap} credits used this month.`,
      heading: headline,
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${user.name ?? 'there'},</p><p style="margin:0;">${spent} of ${cap} development credits have been used this month.${threshold >= 100 ? ' New AI runs that count against this limit are paused until it is raised or the month resets.' : ''}</p>`,
      ctaLabel: 'View usage',
      ctaUrl: url,
    }),
    text: `${headline}. ${spent} of ${cap} development credits used this month. ${url}`,
  });
  return true;
}

export type AlertTarget = {
  scope: 'USER' | 'WORKSPACE' | 'ALLOWANCE';
  scopeId: string;
  notifyUserId: string;
  cap: number;
  spent: number;
  label: string;
};

/**
 * Creates the 80%/100% in-app alerts. The (scope, month, threshold) unique key
 * means each alert exists once per month no matter how often this runs; the email
 * is sent only by the caller that created the row.
 */
export async function recordUsageAlerts(targets: AlertTarget[], now = new Date()) {
  const { period } = periodOf(now);
  let created = 0;
  for (const target of targets) {
    for (const threshold of thresholdsReached(target.spent, target.cap)) {
      const { count } = await prisma.creditUsageAlert.createMany({
        data: [
          {
            scope: target.scope,
            scopeId: target.scopeId,
            userId: target.notifyUserId,
            period,
            threshold,
            spent: target.spent,
            cap: target.cap,
          },
        ],
        skipDuplicates: true,
      });
      if (count !== 1) continue;
      created += 1;
      try {
        if (await emailAlert(target.notifyUserId, target.label, threshold, target.spent, target.cap)) {
          await prisma.creditUsageAlert.updateMany({
            where: { scope: target.scope, scopeId: target.scopeId, period, threshold },
            data: { emailedAt: new Date() },
          });
        }
      } catch (error) {
        console.error('[credits] usage alert email failed:', error);
      }
    }
  }
  return created;
}

/** Called after a charge. Best-effort: alerting must never fail the operation that triggered it. */
export async function evaluateUsageAlerts(userId: string, workspaceId: string | null, now = new Date()) {
  try {
    const targets: AlertTarget[] = [];
    const limits = await prisma.creditSpendLimit.findMany({ where: limitFilter(userId, workspaceId) });
    for (const limit of limits) {
      if (limit.scope === 'USER') {
        targets.push({
          scope: 'USER',
          scopeId: userId,
          notifyUserId: userId,
          cap: limit.monthlyLimit,
          spent: await monthlySpend({ userId }, now),
          label: 'monthly spending limit',
        });
      } else {
        const ws = await prisma.workspace.findUnique({ where: { id: limit.scopeId }, select: { ownerId: true } });
        if (!ws) continue;
        targets.push({
          scope: 'WORKSPACE',
          scopeId: limit.scopeId,
          notifyUserId: ws.ownerId,
          cap: limit.monthlyLimit,
          spent: await monthlySpend({ workspaceId: limit.scopeId }, now),
          label: 'workspace monthly spending limit',
        });
      }
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionPlan: true, subscriptionStatus: true },
    });
    const allowance = PLAN_DEFINITIONS[resolvePlanId(user)].limits.creditsPerMonth;
    if (allowance > 0) {
      targets.push({
        scope: 'ALLOWANCE',
        scopeId: userId,
        notifyUserId: userId,
        cap: allowance,
        spent: await monthlySpend({ userId }, now),
        label: 'monthly plan credit allowance',
      });
    }
    return await recordUsageAlerts(targets, now);
  } catch (error) {
    console.error('[credits] usage alert evaluation failed:', error);
    return 0;
  }
}

export async function listUnreadAlerts(userId: string, take = 10) {
  return prisma.creditUsageAlert.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: 'desc' }, take });
}

export async function markAlertsRead(userId: string) {
  await prisma.creditUsageAlert.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

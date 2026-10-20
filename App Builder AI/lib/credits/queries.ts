import { prisma } from '@/lib/prisma';

import { PLAN_MONTHLY_CREDITS } from '@/lib/billing/credits';
import { isCreditMetered } from './with-credits';
import type { PaidPlanId } from '@/lib/stripe';

export async function getCreditsOverview(userId: string, ledgerTake = 50) {
  const [user, entries] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        creditBalance: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionCurrentPeriodEnd: true,
      },
    }),
    prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: ledgerTake,
    }),
  ]);
  if (!user) return null;
  return {
    balance: user.creditBalance,
    plan: user.subscriptionPlan,
    metered: isCreditMetered(user),
    monthlyAllowance: PLAN_MONTHLY_CREDITS[user.subscriptionPlan as PaidPlanId] ?? 0,
    renewsAt: user.subscriptionCurrentPeriodEnd,
    entries,
  };
}

/** Balance and whether this user is charged; used to show "costs N credits" hints in the UI. */
export async function getCreditHint(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true, subscriptionPlan: true, subscriptionStatus: true },
  });
  return user ? { balance: user.creditBalance, metered: isCreditMetered(user) } : null;
}

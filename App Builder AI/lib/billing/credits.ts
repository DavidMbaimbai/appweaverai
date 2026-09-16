import { prisma } from '@/lib/prisma';
import type { PaidPlanId } from '@/lib/stripe';

/**
 * Monthly credit allotment granted to subscribers of each paid plan. These
 * numbers must stay in sync with the "X credits/mo" badges shown on the
 * pricing page (see `lib/landing-data.ts`).
 *
 * The Free tier's usage limits are a separate mechanism (daily request/token
 * caps in `lib/admin/queries/ai-usage.ts`) and are intentionally not backed
 * by `User.creditBalance`.
 */
export const PLAN_MONTHLY_CREDITS: Record<PaidPlanId, number> = {
  builder: 1200,
  pro: 4000,
  business: 10000,
};

/**
 * Resets a user's credit balance to their plan's full monthly allotment and
 * records the change in `CreditAdjustment` for auditing.
 *
 * This is intentionally a hard reset rather than an increment, so it's safe
 * to call from multiple trigger points (initial checkout activation, a
 * plan-change subscription sync, and each `invoice.paid` renewal) without
 * risking credits stacking up — granting the same plan's amount twice in a
 * row is a no-op. This matches the "N credits a month" marketing promise
 * (a fresh monthly allotment) rather than a rollover/accumulation model.
 */
export async function grantPlanCredits(
  userId: string,
  planId: PaidPlanId,
  reason: string,
) {
  const amount = PLAN_MONTHLY_CREDITS[planId];
  if (!amount) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  });
  if (!user) return;

  const delta = amount - user.creditBalance;
  if (delta === 0) return;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: amount, lowCreditsAlertSentAt: null },
    }),
    prisma.creditAdjustment.create({
      data: {
        userId,
        amount: delta,
        reason,
        // Automated system grants aren't attributed to a support admin.
        adminId: 'system',
      },
    }),
  ]);
}

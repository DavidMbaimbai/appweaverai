import { getCachedSession } from '../auth/cached';
import { isProUser, type UserBillingFields } from '../billing/entitlements';
import { fetchSubscriptionDisplayInfo } from '../billing/stripe-subscription';
import { prisma } from '../prisma';
import { fetchProPlanInfo } from '../stripe';

export async function getUserBillingFields(
  userId: string,
): Promise<UserBillingFields | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionPlan: true,
      subscriptionStatus: true,
    },
  });
}

/**
 * Lightweight billing summary used for chrome that renders on every
 * dashboard page (e.g. the sidebar). Reads only from the DB (kept in sync
 * via Stripe webhooks) instead of calling the Stripe API, so it stays fast
 * on every navigation.
 */
export async function getSidebarBillingSummary(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      creditBalance: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionCurrentPeriodEnd: true,
    },
  });

  if (!user) return null;

  const isActive =
    user.subscriptionStatus === 'active' ||
    user.subscriptionStatus === 'trialing';

  const daysUntilRenewal =
    isActive && user.subscriptionCurrentPeriodEnd
      ? Math.max(
          0,
          Math.ceil(
            (user.subscriptionCurrentPeriodEnd.getTime() - Date.now()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

  return {
    creditBalance: user.creditBalance,
    plan: user.subscriptionPlan,
    daysUntilRenewal,
  };
}

export async function getBillingPageData() {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId || !process.env.DATABASE_URL) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionPlan: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      creditBalance: true,
    },
  });

  if (!user) return null;

  const proPlan = await fetchProPlanInfo();
  const subscription =
    user.stripeSubscriptionId || user.subscriptionPlan === 'pro'
      ? await fetchSubscriptionDisplayInfo(userId)
      : null;

  return {
    plan: isProUser(user) ? ('pro' as const) : ('free' as const),
    status: user.subscriptionStatus,
    hasCustomer: Boolean(user.stripeCustomerId),
    creditBalance: user.creditBalance,
    proPlan,
    subscription,
  };
}

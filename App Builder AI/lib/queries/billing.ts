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
    proPlan,
    subscription,
  };
}

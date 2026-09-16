import type Stripe from 'stripe';

import {
  buildFallbackSubscriptionDisplayInfo,
  buildSubscriptionDisplayInfo,
  getSubscriptionPeriodEnd,
  type SubscriptionDisplayInfo,
} from '@/lib/billing/subscription-display';
import { grantPlanCredits } from '@/lib/billing/credits';
import { prisma } from '@/lib/prisma';
import {
  getStripeClient,
  resolveStripeProPriceId,
  getPlanIdsByPriceId,
  type PaidPlanId,
} from '@/lib/stripe';

const CHECKOUT_SESSION_ID_PATTERN = /^cs_(test|live)_[a-zA-Z0-9]+$/;

export type { SubscriptionDisplayInfo };

export async function fetchSubscriptionDisplayInfo(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      stripeSubscriptionId: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
    },
  });

  if (!user?.stripeSubscriptionId) {
    return null;
  }

  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId,
      {
        expand: ['items.data'],
      },
    );

    return buildSubscriptionDisplayInfo(subscription);
  } catch {
    if (!user.subscriptionStatus) {
      return null;
    }

    return buildFallbackSubscriptionDisplayInfo(user.subscriptionStatus);
  }
}

export function isValidCheckoutSessionId(sessionId: string) {
  return CHECKOUT_SESSION_ID_PATTERN.test(sessionId.trim());
}

export async function syncUserSubscription(
  userId: string,
  subscription: Stripe.Subscription,
  customerId?: string | null,
) {
  const status = subscription.status;
  const isActive = status === 'active' || status === 'trialing';

  const planIdsByPriceId = getPlanIdsByPriceId();
  const subscriptionPriceId = subscription.items.data[0]?.price?.id;
  const resolvedPlanId: PaidPlanId =
    (subscriptionPriceId && planIdsByPriceId[subscriptionPriceId]) ||
    (subscription.metadata?.planId as PaidPlanId | undefined) ||
    'pro';

  const periodEnd = getSubscriptionPeriodEnd(subscription);
  const previousUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionCurrentPeriodEnd: true, subscriptionPlan: true },
  });

  // Reset the "already reminded" marker whenever the billing period end
  // actually changes (e.g. the subscription renewed into a new cycle), so a
  // fresh renewal reminder can be sent again ahead of the new period end.
  const periodEndChanged =
    previousUser?.subscriptionCurrentPeriodEnd?.getTime() !==
    periodEnd?.getTime();

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      subscriptionPlan: isActive ? resolvedPlanId : 'free',
      subscriptionCurrentPeriodEnd: periodEnd,
      ...(periodEndChanged ? { renewalReminderSentForEnd: null } : {}),
    },
  });

  // Grant the plan's monthly credit allotment whenever a paid plan is newly
  // activated or changed (upgrade/downgrade). Renewals within the same plan
  // are refilled separately from `invoice.paid` in the webhook handler, so
  // we deliberately don't re-grant here just because this subscription
  // object was re-synced without an actual plan change (that would wipe out
  // credits the user already spent this period).
  if (isActive && previousUser?.subscriptionPlan !== resolvedPlanId) {
    await grantPlanCredits(
      userId,
      resolvedPlanId,
      previousUser?.subscriptionPlan && previousUser.subscriptionPlan !== 'free'
        ? `Plan changed to ${resolvedPlanId}`
        : `${resolvedPlanId} plan activated`,
    );
  }
}

export async function syncUserFromCheckoutSession(
  userId: string,
  sessionId: string,
) {
  if (!isValidCheckoutSessionId(sessionId)) {
    return { error: 'Invalid checkout session.' as const };
  }

  const stripe = getStripeClient();
  const planIdsByPriceId = getPlanIdsByPriceId();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'subscription'],
  });

  if (session.metadata?.userId !== userId) {
    return {
      error: 'This checkout session does not belong to your account.' as const,
    };
  }

  if (session.mode !== 'subscription') {
    return { error: 'Invalid checkout session type.' as const };
  }

  if (session.status !== 'complete') {
    return { error: 'Checkout is not complete.' as const };
  }

  if (
    session.payment_status !== 'paid' &&
    session.payment_status !== 'no_payment_required'
  ) {
    return { error: 'Checkout payment was not completed.' as const };
  }

  const lineItems = session.line_items?.data ?? [];
  let matchedPlanId: PaidPlanId | null = null;

  for (const item of lineItems) {
    const priceId =
      typeof item.price === 'string' ? item.price : item.price?.id;
    if (priceId && planIdsByPriceId[priceId]) {
      matchedPlanId = planIdsByPriceId[priceId];
      break;
    }
  }

  // Fall back to the legacy single-plan Pro price for existing setups that
  // only configured STRIPE_PRO_PRICE_ID/STRIPE_PRO_PRODUCT_ID.
  if (!matchedPlanId) {
    try {
      const legacyProPriceId = await resolveStripeProPriceId();
      const hasLegacyProPrice = lineItems.some((item) => {
        const priceId =
          typeof item.price === 'string' ? item.price : item.price?.id;
        return priceId === legacyProPriceId;
      });
      if (hasLegacyProPrice) {
        matchedPlanId = 'pro';
      }
    } catch {
      // No legacy Pro price configured either — fall through to error below.
    }
  }

  if (!matchedPlanId) {
    return { error: 'Checkout session is not for a known plan.' as const };
  }

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;

  if (!subscriptionId) {
    return { error: 'No subscription found for this checkout.' as const };
  }

  const subscription =
    typeof session.subscription === 'object' && session.subscription
      ? session.subscription
      : await stripe.subscriptions.retrieve(subscriptionId);

  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    return { error: 'Subscription is not active.' as const };
  }

  await syncUserSubscription(userId, subscription, customerId);
  return { success: true as const, plan: matchedPlanId };
}

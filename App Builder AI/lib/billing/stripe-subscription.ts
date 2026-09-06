import type Stripe from 'stripe';

import {
  buildFallbackSubscriptionDisplayInfo,
  buildSubscriptionDisplayInfo,
  type SubscriptionDisplayInfo,
} from '@/lib/billing/subscription-display';
import { prisma } from '@/lib/prisma';
import { getStripeClient, resolveStripeProPriceId } from '@/lib/stripe';

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

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      subscriptionPlan: isActive ? 'pro' : 'free',
    },
  });
}

export async function syncUserFromCheckoutSession(
  userId: string,
  sessionId: string,
) {
  if (!isValidCheckoutSessionId(sessionId)) {
    return { error: 'Invalid checkout session.' as const };
  }

  const stripe = getStripeClient();
  const expectedPriceId = await resolveStripeProPriceId();

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
  const hasProPrice = lineItems.some((item) => {
    const priceId =
      typeof item.price === 'string' ? item.price : item.price?.id;
    return priceId === expectedPriceId;
  });

  if (!hasProPrice) {
    return { error: 'Checkout session is not for the Pro plan.' as const };
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
  return { success: true as const, plan: 'pro' as const };
}

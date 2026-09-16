'use server';

import { requireUser } from '@/lib/auth/require-user';
import { syncUserFromCheckoutSession, syncUserSubscription } from '@/lib/billing/stripe-subscription';
import { getSubscriptionPeriodEnd } from '@/lib/billing/subscription-display';
import { sendSubscriptionCanceledEmail } from '@/lib/billing/receipts';
import { prisma } from '@/lib/prisma';
import {
  getAppBaseUrl,
  getStripeClient,
  resolveStripeProPriceId,
  resolvePriceIdForPlan,
  type PaidPlanId,
  type BillingPeriod,
} from '@/lib/stripe';

const billingUserSelect = {
  id: true,
  email: true,
  name: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
} as const;

async function getOrCreateStripeCustomer(user: {
  id: string;
  email: string | null;
  name: string | null;
  stripeCustomerId: string | null;
}) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

export async function createProCheckoutSessionAction() {
  const result = await requireUser(billingUserSelect);
  if (result.error || !result.user) {
    return { error: result.error };
  }

  try {
    const stripe = getStripeClient();
    const customerId = await getOrCreateStripeCustomer(result.user);
    const baseUrl = getAppBaseUrl();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: await resolveStripeProPriceId(), quantity: 1 }],
      success_url: `${baseUrl}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/billing?checkout=cancel`,
      metadata: { userId: result.user.id },
      subscription_data: {
        metadata: { userId: result.user.id },
      },
    });

    if (!session.url) {
      return { error: 'Could not start checkout.' };
    }

    return { url: session.url };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not start checkout.';
    return { error: message };
  }
}

/**
 * Starts a Stripe Checkout session for a specific paid plan (Builder/Pro/
 * Business) and billing period, used directly by the marketing pricing page
 * (see components/landing/pricing/pricing-cards.tsx) so upgrading goes
 * straight to Stripe rather than the generic /app/billing screen.
 */
export async function createPlanCheckoutSessionAction(
  planId: PaidPlanId,
  period: BillingPeriod,
) {
  const result = await requireUser(billingUserSelect);
  if (result.error || !result.user) {
    return { error: result.error };
  }

  try {
    const stripe = getStripeClient();
    const customerId = await getOrCreateStripeCustomer(result.user);
    const baseUrl = getAppBaseUrl();
    const priceId = resolvePriceIdForPlan(planId, period);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/billing?checkout=cancel`,
      metadata: { userId: result.user.id, planId, period },
      subscription_data: {
        metadata: { userId: result.user.id, planId, period },
      },
    });

    if (!session.url) {
      return { error: 'Could not start checkout.' };
    }

    return { url: session.url };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not start checkout.';
    return { error: message };
  }
}

export async function createBillingPortalSessionAction() {
  const result = await requireUser(billingUserSelect);
  if (result.error || !result.user) {
    return { error: result.error };
  }

  if (!result.user.stripeCustomerId) {
    return { error: 'No billing account found yet.' };
  }

  try {
    const stripe = getStripeClient();
    const portal = await stripe.billingPortal.sessions.create({
      customer: result.user.stripeCustomerId,
      return_url: `${getAppBaseUrl()}/app/billing`,
    });

    return { url: portal.url };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not open billing portal.';
    return { error: message };
  }
}

export async function syncBillingAfterCheckoutAction(sessionId: string) {
  const result = await requireUser(billingUserSelect);
  if (result.error || !result.user) {
    return { error: result.error };
  }

  try {
    return await syncUserFromCheckoutSession(result.user.id, sessionId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not sync subscription.';
    return { error: message };
  }
}

/**
 * Schedules the user's active subscription to cancel at the end of the
 * current billing period (they keep access until then — no immediate loss
 * of service). Used by the in-app "Cancel subscription" action on the
 * billing page so users don't have to leave the app / go through the
 * Stripe portal just to cancel.
 */
export async function cancelSubscriptionAction() {
  const result = await requireUser(billingUserSelect);
  if (result.error || !result.user) {
    return { error: result.error };
  }

  if (!result.user.stripeSubscriptionId) {
    return { error: 'No active subscription found.' };
  }

  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.update(
      result.user.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    await syncUserSubscription(
      result.user.id,
      subscription,
      result.user.stripeCustomerId,
    );

    const periodEnd = getSubscriptionPeriodEnd(subscription);
    await sendSubscriptionCanceledEmail({
      email: result.user.email,
      name: result.user.name,
      accessUntilLabel: periodEnd
        ? new Intl.DateTimeFormat('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }).format(periodEnd)
        : null,
    });

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Could not cancel your subscription.';
    return { error: message };
  }
}

/**
 * Reverses a scheduled cancellation (cancel_at_period_end) so the
 * subscription keeps renewing as normal. Used by the in-app "Reactivate
 * subscription" action.
 */
export async function reactivateSubscriptionAction() {
  const result = await requireUser(billingUserSelect);
  if (result.error || !result.user) {
    return { error: result.error };
  }

  if (!result.user.stripeSubscriptionId) {
    return { error: 'No subscription found.' };
  }

  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.update(
      result.user.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );

    await syncUserSubscription(
      result.user.id,
      subscription,
      result.user.stripeCustomerId,
    );

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Could not reactivate your subscription.';
    return { error: message };
  }
}

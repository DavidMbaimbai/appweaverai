'use server';

import { requireUser } from '@/lib/auth/require-user';
import { syncUserFromCheckoutSession } from '@/lib/billing/stripe-subscription';
import { prisma } from '@/lib/prisma';
import {
  getAppBaseUrl,
  getStripeClient,
  resolveStripeProPriceId,
} from '@/lib/stripe';

const billingUserSelect = {
  id: true,
  email: true,
  name: true,
  stripeCustomerId: true,
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

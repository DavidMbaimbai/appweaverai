import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
import { syncUserSubscription } from '@/lib/billing/stripe-subscription';
import {
  PAID_PLAN_LABELS,
  sendPaymentReceiptEmail,
  sendSubscriptionConfirmationEmail,
} from '@/lib/billing/receipts';
import { getStripeClient, getPlanIdsByPriceId } from '@/lib/stripe';

async function markEventProcessed(eventId: string) {
  const existing = await prisma.stripeEvent.findUnique({
    where: { id: eventId },
    select: { id: true },
  });

  if (existing) return false;

  await prisma.stripeEvent.create({ data: { id: eventId } });
  return true;
}

async function resolveUserIdFromCustomer(customerId: string) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  return user?.id ?? null;
}

async function notifyUser(
  userId: string,
  notify: (user: { email: string | null; name: string | null }) => Promise<void>,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return;

  try {
    await notify(user);
  } catch (error) {
    console.error(`Failed to send billing email to user ${userId}:`, error);
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Webhook secret not configured.' },
      { status: 500 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const stripe = getStripeClient();
  const body = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const shouldProcess = await markEventProcessed(event.id);
  if (!shouldProcess) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (userId && customerId) {
          let planId = session.metadata?.planId ?? 'pro';

          if (subscriptionId) {
            const subscription =
              await stripe.subscriptions.retrieve(subscriptionId);
            await syncUserSubscription(userId, subscription, customerId);
            const priceId = subscription.items.data[0]?.price?.id;
            planId =
              (priceId && getPlanIdsByPriceId()[priceId]) ||
              (subscription.metadata?.planId as string | undefined) ||
              planId;
          } else {
            await prisma.user.update({
              where: { id: userId },
              data: {
                stripeCustomerId: customerId,
                subscriptionPlan: planId,
                subscriptionStatus: 'active',
              },
            });
          }

          const planLabel = PAID_PLAN_LABELS[planId] ?? 'Pro';
          await notifyUser(userId, (user) =>
            sendSubscriptionConfirmationEmail({
              email: user.email,
              name: user.name,
              planLabel,
            }),
          );
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id;

        const userId = customerId
          ? await resolveUserIdFromCustomer(customerId)
          : null;

        if (userId) {
          await notifyUser(userId, (user) =>
            sendPaymentReceiptEmail({
              email: user.email,
              name: user.name,
              invoice,
            }),
          );
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer.id;

        const userId =
          subscription.metadata?.userId ??
          (customerId ? await resolveUserIdFromCustomer(customerId) : null);

        if (userId) {
          if (event.type === 'customer.subscription.deleted') {
            await prisma.user.update({
              where: { id: userId },
              data: {
                stripeSubscriptionId: null,
                subscriptionStatus: 'canceled',
                subscriptionPlan: 'free',
              },
            });
          } else {
            await syncUserSubscription(userId, subscription);
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

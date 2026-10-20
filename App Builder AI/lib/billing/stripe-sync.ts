import type Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
import { getSubscriptionPeriodEnd } from '@/lib/billing/subscription-display';
import { getPlanIdsByPriceId } from '@/lib/stripe';

/** Subscription statuses that still bill the customer, so they count toward MRR. */
export const MRR_STATUSES = ['active', 'trialing', 'past_due'] as const;

/** Normalises one recurring price to a monthly amount in cents (rounded). */
export function monthlyCents(unitAmountCents: number, quantity: number, interval: string, intervalCount: number) {
  const total = unitAmountCents * Math.max(1, quantity);
  const count = Math.max(1, intervalCount);
  switch (interval) {
    case 'month':
      return Math.round(total / count);
    case 'year':
      return Math.round(total / (12 * count));
    case 'week':
      return Math.round((total * 52) / (12 * count));
    case 'day':
      return Math.round((total * 365) / (12 * count));
    default:
      return 0;
  }
}

export function subscriptionMrr(subscription: Stripe.Subscription) {
  const counted = (MRR_STATUSES as readonly string[]).includes(subscription.status);
  let mrr = 0;
  let currency = 'usd';
  let interval = 'month';
  let intervalCount = 1;
  let unit = 0;
  let quantity = 1;
  for (const item of subscription.items?.data ?? []) {
    const price = item.price;
    if (!price?.recurring) continue;
    currency = price.currency;
    interval = price.recurring.interval;
    intervalCount = price.recurring.interval_count;
    unit = price.unit_amount ?? 0;
    quantity = item.quantity ?? 1;
    mrr += monthlyCents(unit, quantity, interval, intervalCount);
  }
  return { mrrCents: counted ? mrr : 0, currency, interval, intervalCount, unitAmountCents: unit, quantity };
}

const at = (ts: number | null | undefined) => (typeof ts === 'number' ? new Date(ts * 1000) : null);
const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : (value?.id ?? null));

async function userIdForCustomer(customerId: string) {
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
  return user?.id ?? null;
}

/** Records the subscription's current state and appends an MRR change when the amount differs from the last one. */
export async function syncSubscriptionRecord(subscription: Stripe.Subscription, eventId: string, eventCreated: number) {
  const eventAt = new Date(eventCreated * 1000);
  const existing = await prisma.stripeSubscription.findUnique({ where: { id: subscription.id }, select: { lastEventAt: true } });
  if (existing && existing.lastEventAt > eventAt) return false;

  const customerId = idOf(subscription.customer) ?? '';
  const userId = subscription.metadata?.userId ?? (customerId ? await userIdForCustomer(customerId) : null);
  const priceId = subscription.items?.data[0]?.price?.id;
  const planId = (priceId && getPlanIdsByPriceId()[priceId]) || (subscription.metadata?.planId as string | undefined) || null;
  const m = subscriptionMrr(subscription);

  const data = {
    userId,
    customerId,
    status: subscription.status,
    planId,
    interval: m.interval,
    intervalCount: m.intervalCount,
    unitAmountCents: m.unitAmountCents,
    quantity: m.quantity,
    currency: m.currency,
    mrrCents: m.mrrCents,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    currentPeriodEnd: getSubscriptionPeriodEnd(subscription),
    startedAt: at(subscription.start_date) ?? eventAt,
    endedAt: at(subscription.ended_at),
    lastEventAt: eventAt,
  };
  await prisma.stripeSubscription.upsert({ where: { id: subscription.id }, create: { id: subscription.id, ...data }, update: data });

  const last = await prisma.stripeSubscriptionMrrChange.findFirst({
    where: { subscriptionId: subscription.id },
    orderBy: { effectiveAt: 'desc' },
    select: { mrrCents: true, currency: true },
  });
  if (!last || last.mrrCents !== m.mrrCents) {
    await prisma.stripeSubscriptionMrrChange.createMany({
      data: [
        {
          subscriptionId: subscription.id,
          userId,
          planId,
          currency: m.currency,
          mrrCents: m.mrrCents,
          effectiveAt: eventAt,
          stripeEventId: eventId,
        },
      ],
      skipDuplicates: true,
    });
  }
  return true;
}

/** Upserts an invoice from a webhook or API payload; older payloads never overwrite newer ones. */
export async function upsertInvoiceRecord(invoice: Stripe.Invoice, eventCreated: number) {
  if (!invoice.id) return false;
  const eventAt = new Date(eventCreated * 1000);
  const existing = await prisma.stripeInvoice.findUnique({ where: { id: invoice.id }, select: { lastEventAt: true } });
  if (existing && existing.lastEventAt > eventAt) return false;

  const customerId = idOf(invoice.customer) ?? '';
  const userId = customerId ? await userIdForCustomer(customerId) : null;
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription ?? null);
  const line = invoice.lines?.data[0];
  const priceId = line?.pricing?.price_details?.price;
  const planId = (typeof priceId === 'string' && getPlanIdsByPriceId()[priceId]) || null;

  const data = {
    userId,
    customerId,
    subscriptionId,
    number: invoice.number ?? null,
    status: invoice.status ?? 'draft',
    currency: invoice.currency,
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    amountRemainingCents: invoice.amount_remaining,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    billingReason: invoice.billing_reason ?? null,
    description: invoice.description ?? line?.description ?? null,
    planId,
    periodStart: at(invoice.period_start),
    periodEnd: at(invoice.period_end),
    attemptCount: invoice.attempt_count ?? 0,
    nextPaymentAttemptAt: at(invoice.next_payment_attempt),
    paidAt: at(invoice.status_transitions?.paid_at),
    stripeCreatedAt: at(invoice.created) ?? eventAt,
    lastEventAt: eventAt,
  };
  await prisma.stripeInvoice.upsert({ where: { id: invoice.id }, create: { id: invoice.id, ...data }, update: data });
  return true;
}

export async function markPaymentFailed(userId: string, invoice: Stripe.Invoice, eventCreated: number) {
  const eventAt = new Date(eventCreated * 1000);
  const state = await prisma.billingCustomerState.findUnique({ where: { userId } });
  if (state?.paymentFailedEventAt && state.paymentFailedEventAt > eventAt) return;
  await prisma.billingCustomerState.upsert({
    where: { userId },
    create: {
      userId,
      paymentFailedAt: eventAt,
      paymentFailedEventAt: eventAt,
      paymentFailedInvoiceId: invoice.id,
      paymentFailedAttempts: invoice.attempt_count ?? 1,
    },
    update: {
      paymentFailedAt: state?.paymentFailedAt ?? eventAt,
      paymentFailedEventAt: eventAt,
      paymentFailedInvoiceId: invoice.id,
      paymentFailedAttempts: invoice.attempt_count ?? 1,
    },
  });
}

export async function clearPaymentFailed(userId: string, eventCreated: number) {
  const eventAt = new Date(eventCreated * 1000);
  const state = await prisma.billingCustomerState.findUnique({ where: { userId } });
  if (!state?.paymentFailedAt) return;
  if (state.paymentFailedEventAt && state.paymentFailedEventAt > eventAt) return;
  await prisma.billingCustomerState.update({
    where: { userId },
    data: { paymentFailedAt: null, paymentFailedInvoiceId: null, paymentFailedEventAt: eventAt, paymentFailedAttempts: 0 },
  });
}

export async function recordChargeRefund(charge: Stripe.Charge, eventCreated: number) {
  const eventAt = new Date(eventCreated * 1000);
  const existing = await prisma.stripeChargeRefund.findUnique({ where: { chargeId: charge.id }, select: { lastEventAt: true } });
  if (existing && existing.lastEventAt > eventAt) return;
  const customerId = idOf(charge.customer);
  const data = {
    paymentIntentId: idOf(charge.payment_intent),
    customerId,
    userId: customerId ? await userIdForCustomer(customerId) : null,
    amountRefundedCents: charge.amount_refunded,
    currency: charge.currency,
    lastEventAt: eventAt,
  };
  await prisma.stripeChargeRefund.upsert({ where: { chargeId: charge.id }, create: { chargeId: charge.id, ...data }, update: data });
}

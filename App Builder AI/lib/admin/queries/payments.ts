import type Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
import { getStripeClient, isStripeConfigured } from '@/lib/stripe';

export const ADMIN_PAYMENT_STATUSES = [
  'succeeded',
  'failed',
  'pending',
  'refunded',
] as const;

export type AdminPaymentStatus = (typeof ADMIN_PAYMENT_STATUSES)[number];

export type PaymentListItem = {
  id: string;
  providerTransactionId: string;
  customerEmail: string | null;
  amount: number;
  currency: string;
  status: AdminPaymentStatus;
  createdAt: Date;
  amountRefunded: number;
};

export type PaymentRefundSummary = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: Date;
  reason: string | null;
};

export type PaymentDetail = {
  id: string;
  providerTransactionId: string;
  amount: number;
  amountRefunded: number;
  refundableAmount: number;
  currency: string;
  status: AdminPaymentStatus;
  createdAt: Date;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  paymentIntentId: string | null;
  paymentIntentStatus: string | null;
  receiptUrl: string | null;
  paymentMethod:
    | {
        brand: string | null;
        last4: string | null;
        funding: string | null;
      }
    | null;
  refunds: PaymentRefundSummary[];
  localUser:
    | {
        id: string;
        name: string | null;
        email: string | null;
        username: string | null;
        stripeSubscriptionId: string | null;
        subscriptionPlan: string;
      }
    | null;
};

export type PaymentListResult = {
  configured: boolean;
  message: string | null;
  payments: PaymentListItem[];
  nextCursor: string | null;
  statusFilter: AdminPaymentStatus | null;
  statusFilterMode: 'none' | 'page';
  query: string;
};

type ListPaymentsInput = {
  cursor?: string;
  status?: string;
  query?: string;
  pageSize?: number;
};

type ChargeWithInvoice = Stripe.Charge & {
  invoice?: string | Stripe.Invoice | null;
};

function normalizePaymentStatus(
  value: string | null | undefined,
): AdminPaymentStatus | null {
  if (!value) return null;

  return ADMIN_PAYMENT_STATUSES.includes(value as AdminPaymentStatus)
    ? (value as AdminPaymentStatus)
    : null;
}

function getChargeStatus(charge: Stripe.Charge): AdminPaymentStatus {
  if (charge.refunded || charge.amount_refunded > 0) {
    return 'refunded';
  }

  if (charge.status === 'failed') return 'failed';
  if (charge.status === 'pending') return 'pending';
  return 'succeeded';
}

function getSafeCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
) {
  if (!customer || typeof customer === 'string') {
    return null;
  }

  if ('deleted' in customer && customer.deleted) {
    return null;
  }

  return customer;
}

function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
) {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

function getCustomerEmail(charge: Stripe.Charge) {
  const customer = getSafeCustomer(charge.customer);
  return (
    customer?.email ??
    charge.billing_details.email ??
    charge.receipt_email ??
    null
  );
}

function getInvoice(
  invoice: string | Stripe.Invoice | null | undefined,
): Stripe.Invoice | null {
  if (!invoice || typeof invoice === 'string') {
    return null;
  }

  return invoice;
}

function getSubscriptionId(invoice: string | Stripe.Invoice | null | undefined) {
  const expandedInvoice = getInvoice(invoice);
  const subscriptionDetails =
    expandedInvoice?.parent?.type === 'subscription_details'
      ? expandedInvoice.parent.subscription_details
      : null;
  const subscription = subscriptionDetails?.subscription;
  if (!subscription) return null;

  return typeof subscription === 'string' ? subscription : subscription.id;
}

function mapChargeSummary(charge: Stripe.Charge): PaymentListItem {
  return {
    id: charge.id,
    providerTransactionId: charge.id,
    customerEmail: getCustomerEmail(charge),
    amount: charge.amount,
    currency: charge.currency.toUpperCase(),
    status: getChargeStatus(charge),
    createdAt: new Date(charge.created * 1000),
    amountRefunded: charge.amount_refunded,
  };
}

function isNotFoundStripeError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 404
  );
}

async function findLocalUserForPayment({
  customerId,
  customerEmail,
  subscriptionId,
}: {
  customerId: string | null;
  customerEmail: string | null;
  subscriptionId: string | null;
}) {
  const orConditions = [
    customerId ? { stripeCustomerId: customerId } : null,
    subscriptionId ? { stripeSubscriptionId: subscriptionId } : null,
    customerEmail ? { email: customerEmail } : null,
  ].filter((value): value is NonNullable<typeof value> => value !== null);

  if (orConditions.length === 0) {
    return null;
  }

  return prisma.user.findFirst({
    where: { OR: orConditions },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      stripeSubscriptionId: true,
      subscriptionPlan: true,
    },
  });
}

export async function listPayments({
  cursor,
  status,
  query,
  pageSize = 25,
}: ListPaymentsInput): Promise<PaymentListResult> {
  if (!isStripeConfigured()) {
    return {
      configured: false,
      message: 'Stripe is not configured. Payment data is unavailable.',
      payments: [],
      nextCursor: null,
      statusFilter: null,
      statusFilterMode: 'none',
      query: query?.trim() ?? '',
    };
  }

  const normalizedStatus = normalizePaymentStatus(status);
  const normalizedQuery = query?.trim() ?? '';
  const stripe = getStripeClient();

  if (normalizedQuery) {
    try {
      const charge = await stripe.charges.retrieve(normalizedQuery, {
        expand: ['customer'],
      });

      const payment = mapChargeSummary(charge);
      const matchesFilter =
        !normalizedStatus || payment.status === normalizedStatus;

      return {
        configured: true,
        message: null,
        payments: matchesFilter ? [payment] : [],
        nextCursor: null,
        statusFilter: normalizedStatus,
        statusFilterMode: 'none',
        query: normalizedQuery,
      };
    } catch (error) {
      if (isNotFoundStripeError(error)) {
        return {
          configured: true,
          message: null,
          payments: [],
          nextCursor: null,
          statusFilter: normalizedStatus,
          statusFilterMode: 'none',
          query: normalizedQuery,
        };
      }

      throw error;
    }
  }

  // Stripe's charges.list API does not support server-side status filtering.
  // We still expose the filter in the UI and apply it to the current page.
  const charges = await stripe.charges.list({
    limit: Math.min(Math.max(pageSize, 1), 100),
    starting_after: cursor || undefined,
    expand: ['data.customer'],
  });

  const items = charges.data.map(mapChargeSummary);
  const payments = normalizedStatus
    ? items.filter((payment) => payment.status === normalizedStatus)
    : items;

  return {
    configured: true,
    message: null,
    payments,
    nextCursor: charges.has_more ? charges.data.at(-1)?.id ?? null : null,
    statusFilter: normalizedStatus,
    statusFilterMode: normalizedStatus ? 'page' : 'none',
    query: normalizedQuery,
  };
}

export async function getPaymentDetail(
  chargeId: string,
): Promise<{ configured: boolean; message: string | null; payment: PaymentDetail | null }> {
  if (!isStripeConfigured()) {
    return {
      configured: false,
      message: 'Stripe is not configured. Payment details are unavailable.',
      payment: null,
    };
  }

  const stripe = getStripeClient();

  let charge: ChargeWithInvoice;
  try {
    charge = (await stripe.charges.retrieve(chargeId, {
      expand: ['customer', 'invoice', 'invoice.subscription', 'payment_intent'],
    })) as ChargeWithInvoice;
  } catch (error) {
    if (isNotFoundStripeError(error)) {
      return { configured: true, message: null, payment: null };
    }

    throw error;
  }

  const customerId = getCustomerId(charge.customer);
  const customerEmail = getCustomerEmail(charge);
  const subscriptionId = getSubscriptionId(charge.invoice);

  const [refunds, localUser] = await Promise.all([
    stripe.refunds.list({ charge: charge.id, limit: 20 }),
    findLocalUserForPayment({ customerId, customerEmail, subscriptionId }),
  ]);

  const paymentIntent =
    charge.payment_intent && typeof charge.payment_intent !== 'string'
      ? charge.payment_intent
      : null;
  const card = charge.payment_method_details?.card;

  return {
    configured: true,
    message: null,
    payment: {
      id: charge.id,
      providerTransactionId: charge.id,
      amount: charge.amount,
      amountRefunded: charge.amount_refunded,
      refundableAmount: Math.max(charge.amount - charge.amount_refunded, 0),
      currency: charge.currency.toUpperCase(),
      status: getChargeStatus(charge),
      createdAt: new Date(charge.created * 1000),
      customerId,
      customerEmail,
      customerName: charge.billing_details.name ?? getSafeCustomer(charge.customer)?.name ?? null,
      invoiceId:
        typeof charge.invoice === 'string'
          ? charge.invoice
          : charge.invoice?.id ?? null,
      subscriptionId,
      paymentIntentId:
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id ?? null,
      paymentIntentStatus: paymentIntent?.status ?? null,
      receiptUrl: charge.receipt_url ?? null,
      paymentMethod: card
        ? {
            brand: card.brand ?? null,
            last4: card.last4 ?? null,
            funding: card.funding ?? null,
          }
        : null,
      refunds: refunds.data.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency.toUpperCase(),
        status: refund.status ?? 'pending',
        createdAt: new Date(refund.created * 1000),
        reason: refund.reason ?? null,
      })),
      localUser,
    },
  };
}

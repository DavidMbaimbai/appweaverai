import { prisma } from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';

import { upsertInvoiceRecord } from './stripe-sync';

/** Local invoice rows are refreshed from the Stripe API at most this often per customer. */
export const INVOICE_CACHE_MS = 10 * 60 * 1000;

export function isInvoiceCacheFresh(syncedAt: Date | null | undefined, now = new Date()) {
  return !!syncedAt && now.getTime() - syncedAt.getTime() < INVOICE_CACHE_MS;
}

/** Pulls the customer's invoices from Stripe into the local cache. Never fabricates invoices. */
export async function refreshInvoices(userId: string, stripeCustomerId: string) {
  const stripe = getStripeClient();
  const list = await stripe.invoices.list({ customer: stripeCustomerId, limit: 24 });
  const nowTs = Math.floor(Date.now() / 1000);
  for (const invoice of list.data) {
    await upsertInvoiceRecord(invoice, nowTs);
  }
  await prisma.billingCustomerState.upsert({
    where: { userId },
    create: { userId, invoicesSyncedAt: new Date() },
    update: { invoicesSyncedAt: new Date() },
  });
}

/** The user's own invoices (cached, refreshed from Stripe when stale) plus credit-pack receipts. */
export async function loadCustomerInvoices(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
  const state = await prisma.billingCustomerState.findUnique({ where: { userId } });
  let refreshError: string | null = null;
  if (user?.stripeCustomerId && !isInvoiceCacheFresh(state?.invoicesSyncedAt)) {
    try {
      await refreshInvoices(userId, user.stripeCustomerId);
    } catch {
      refreshError = 'Could not refresh invoices from Stripe; showing the last synced copy.';
    }
  }
  const [invoices, receipts] = await Promise.all([
    prisma.stripeInvoice.findMany({
      where: { userId, status: { not: 'draft' } },
      orderBy: { stripeCreatedAt: 'desc' },
      take: 50,
    }),
    prisma.marketingPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  return { invoices, receipts, refreshError };
}

export async function loadPaymentFailure(userId: string) {
  const state = await prisma.billingCustomerState.findUnique({ where: { userId } });
  if (!state?.paymentFailedAt) return null;
  const invoice = state.paymentFailedInvoiceId
    ? await prisma.stripeInvoice.findFirst({
        where: { id: state.paymentFailedInvoiceId, userId },
        select: { hostedInvoiceUrl: true, nextPaymentAttemptAt: true, amountRemainingCents: true, currency: true },
      })
    : null;
  return { since: state.paymentFailedAt, attempts: state.paymentFailedAttempts, invoice };
}

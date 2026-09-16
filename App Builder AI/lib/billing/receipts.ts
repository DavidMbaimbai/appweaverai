import type Stripe from 'stripe';

import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '') ||
    'https://appweaverai.com'
  );
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** Canonical display names for paid plan ids, shared across billing emails. */
export const PAID_PLAN_LABELS: Record<string, string> = {
  builder: 'Builder',
  pro: 'Pro',
  business: 'Business',
};

/** Sent once right after a checkout completes and a subscription becomes active. */
export async function sendSubscriptionConfirmationEmail({
  email,
  name,
  planLabel,
}: {
  email: string | null | undefined;
  name: string | null | undefined;
  planLabel: string;
}) {
  if (!email) return;

  const appUrl = getAppUrl();
  const displayName = name?.trim() || 'there';

  await sendEmail({
    to: email,
    subject: `You're subscribed to AppWeaver AI ${planLabel}`,
    html: renderBrandedEmail({
      previewText: `Your ${planLabel} subscription is now active.`,
      heading: 'Thanks for subscribing!',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${displayName},</p>
        <p style="margin:0 0 12px;">Your <strong>AppWeaver AI ${planLabel}</strong> subscription is now active. You now have access to everything included in your plan.</p>
        <p style="margin:0;">You can manage your subscription, view invoices, or update payment details anytime from Billing.</p>
      `,
      ctaLabel: 'View billing',
      ctaUrl: `${appUrl}/app/billing`,
    }),
    text: `Hi ${displayName}, your AppWeaver AI ${planLabel} subscription is now active. Manage it at ${appUrl}/app/billing.`,
  });
}

/** Sent for every successful invoice payment (first payment and renewals alike). */
export async function sendPaymentReceiptEmail({
  email,
  name,
  invoice,
}: {
  email: string | null | undefined;
  name: string | null | undefined;
  invoice: Stripe.Invoice;
}) {
  if (!email) return;

  const appUrl = getAppUrl();
  const displayName = name?.trim() || 'there';
  const amountLabel = formatAmount(
    invoice.amount_paid,
    invoice.currency ?? 'usd',
  );
  const dateLabel = formatDate(
    new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000),
  );
  const description =
    invoice.lines.data[0]?.description ?? 'AppWeaver AI subscription';
  const invoiceUrl = invoice.hosted_invoice_url;
  const invoiceNumber = invoice.number;

  await sendEmail({
    to: email,
    subject: `Your AppWeaver AI receipt — ${amountLabel}`,
    html: renderBrandedEmail({
      previewText: `Payment of ${amountLabel} received on ${dateLabel}.`,
      heading: 'Payment receipt',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${displayName},</p>
        <p style="margin:0 0 12px;">We&rsquo;ve received your payment. Here&rsquo;s your receipt:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;border-radius:12px;background:#faf6f1;padding:16px 18px;">
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#696c74;">Description</td>
            <td style="padding:4px 0;font-size:13px;color:#0e0e0f;text-align:right;">${description}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#696c74;">Amount</td>
            <td style="padding:4px 0;font-size:13px;color:#0e0e0f;text-align:right;">${amountLabel}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#696c74;">Date</td>
            <td style="padding:4px 0;font-size:13px;color:#0e0e0f;text-align:right;">${dateLabel}</td>
          </tr>
          ${
            invoiceNumber
              ? `<tr>
                  <td style="padding:4px 0;font-size:13px;color:#696c74;">Invoice #</td>
                  <td style="padding:4px 0;font-size:13px;color:#0e0e0f;text-align:right;">${invoiceNumber}</td>
                </tr>`
              : ''
          }
        </table>
        <p style="margin:0;">You can also view or download this invoice anytime from Billing.</p>
      `,
      ctaLabel: invoiceUrl ? 'View invoice' : 'View billing',
      ctaUrl: invoiceUrl ?? `${appUrl}/app/billing`,
    }),
    text: `Hi ${displayName}, we've received your payment of ${amountLabel} on ${dateLabel} for ${description}.${invoiceUrl ? ` View your invoice at ${invoiceUrl}.` : ''}`,
  });
}

/** Sent when a user schedules their subscription to cancel at period end. */
export async function sendSubscriptionCanceledEmail({
  email,
  name,
  accessUntilLabel,
}: {
  email: string | null | undefined;
  name: string | null | undefined;
  accessUntilLabel: string | null;
}) {
  if (!email) return;

  const appUrl = getAppUrl();
  const displayName = name?.trim() || 'there';

  await sendEmail({
    to: email,
    subject: 'Your AppWeaver AI subscription has been canceled',
    html: renderBrandedEmail({
      previewText: accessUntilLabel
        ? `You'll keep access until ${accessUntilLabel}.`
        : 'Your subscription cancellation is confirmed.',
      heading: 'Subscription canceled',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${displayName},</p>
        <p style="margin:0 0 12px;">We&rsquo;ve confirmed your cancellation. ${
          accessUntilLabel
            ? `You&rsquo;ll keep full access until <strong>${accessUntilLabel}</strong>, after which your account moves to the free plan.`
            : 'Your subscription will not renew.'
        }</p>
        <p style="margin:0;">Changed your mind? You can reactivate anytime before then from Billing.</p>
      `,
      ctaLabel: 'Manage billing',
      ctaUrl: `${appUrl}/app/billing`,
    }),
    text: `Hi ${displayName}, we've confirmed your subscription cancellation.${accessUntilLabel ? ` You'll keep access until ${accessUntilLabel}.` : ''} Reactivate anytime at ${appUrl}/app/billing.`,
  });
}

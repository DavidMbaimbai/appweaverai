import Link from 'next/link';

import { loadPaymentFailure } from '@/lib/billing/invoices';

/** Shown while the last payment failed (set by invoice.payment_failed, cleared by invoice.paid). */
export async function PaymentFailedBanner({ userId }: { userId: string }) {
  const failure = await loadPaymentFailure(userId).catch(() => null);
  if (!failure) return null;
  const retry = failure.invoice?.nextPaymentAttemptAt;
  return (
    <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-app-text">
      <p className="font-medium">Your last payment failed.</p>
      <p className="mt-1 text-app-text-secondary">
        Update your payment method to keep your plan and credits.
        {retry ? ` Stripe will retry on ${retry.toLocaleDateString('en-GB')}.` : ''} Your plan is not changed until Stripe
        stops retrying.
      </p>
      <p className="mt-2 flex gap-4">
        <Link href="/app/billing" className="font-medium text-appweaver-orange">Manage billing</Link>
        {failure.invoice?.hostedInvoiceUrl ? (
          <a href={failure.invoice.hostedInvoiceUrl} className="underline" target="_blank" rel="noreferrer">Pay invoice</a>
        ) : null}
      </p>
    </div>
  );
}

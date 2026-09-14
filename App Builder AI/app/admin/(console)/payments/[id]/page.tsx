import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AdminEmptyState,
  AdminPageHeader,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { RefundPaymentButton } from '@/components/admin/payments/refund-payment-button';
import { hasPermission } from '@/lib/admin/permissions';
import {
  getPaymentDetail,
  type AdminPaymentStatus,
} from '@/lib/admin/queries/payments';
import { requireAdmin } from '@/lib/auth/require-admin';

const STATUS_TONE: Record<
  AdminPaymentStatus,
  'success' | 'warning' | 'danger' | 'info'
> = {
  succeeded: 'success',
  failed: 'danger',
  pending: 'warning',
  refunded: 'info',
};

export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin('payments:read');
  if (!auth.ok) return null;

  const { id } = await params;
  const detail = await getPaymentDetail(id);

  if (!detail.configured) {
    return (
      <div>
        <AdminPageHeader
          title="Payment detail"
          description="Investigate a Stripe charge and related refunds."
        />
        <AdminEmptyState message={detail.message ?? 'Stripe is not configured.'} />
      </div>
    );
  }

  if (!detail.payment) notFound();

  const payment = detail.payment;
  const canRefund =
    hasPermission(auth.admin.adminRole, 'payments:refund') &&
    payment.refundableAmount > 0;

  return (
    <div>
      <AdminPageHeader
        title={payment.providerTransactionId}
        description={payment.customerEmail ?? 'Stripe charge'}
        actions={
          <StatusPill tone={STATUS_TONE[payment.status]}>
            {payment.status}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Transaction summary">
            <Field label="Charge ID" value={payment.providerTransactionId} mono />
            <Field
              label="Amount"
              value={formatCurrencyCents(payment.amount, payment.currency)}
            />
            <Field
              label="Refunded"
              value={formatCurrencyCents(
                payment.amountRefunded,
                payment.currency,
              )}
            />
            <Field
              label="Refundable balance"
              value={formatCurrencyCents(
                payment.refundableAmount,
                payment.currency,
              )}
            />
            <Field label="Status" value={payment.status} />
            <Field label="Created" value={formatDateTime(payment.createdAt)} />
            <Field label="Currency" value={payment.currency} />
            <Field label="Payment intent" value={payment.paymentIntentId ?? '—'} mono />
            <Field
              label="Payment intent status"
              value={payment.paymentIntentStatus ?? '—'}
            />
            <Field label="Invoice" value={payment.invoiceId ?? '—'} mono />
            <Field
              label="Subscription"
              value={payment.subscriptionId ?? '—'}
              mono
            />
          </Section>

          <Section title="Customer">
            <Field label="Email" value={payment.customerEmail ?? '—'} />
            <Field label="Name" value={payment.customerName ?? '—'} />
            <Field label="Stripe customer" value={payment.customerId ?? '—'} mono />
            {payment.localUser ? (
              <div className="pt-2 text-sm text-app-text-secondary">
                <p className="mb-2 text-app-text-muted">Linked local account</p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/users/${payment.localUser.id}`}
                    className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                    View user
                  </Link>
                  {(payment.localUser.stripeSubscriptionId ||
                    payment.localUser.subscriptionPlan !== 'free') && (
                    <Link
                      href={`/admin/subscriptions/${payment.localUser.id}`}
                      className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                      View subscription
                    </Link>
                  )}
                </div>
              </div>
            ) : null}
          </Section>

          <Section title="Payment method">
            <Field label="Brand" value={payment.paymentMethod?.brand ?? '—'} />
            <Field label="Last 4" value={payment.paymentMethod?.last4 ?? '—'} />
            <Field label="Funding" value={payment.paymentMethod?.funding ?? '—'} />
            {payment.receiptUrl ? (
              <div className="pt-2 text-sm">
                <a
                  href={payment.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-app-accent-blue hover:underline">
                  Open Stripe receipt →
                </a>
              </div>
            ) : null}
          </Section>

          <Section title="Refunds">
            {payment.refunds.length === 0 ? (
              <p className="text-sm text-app-text-muted">
                No refunds have been issued for this payment.
              </p>
            ) : (
              <ul className="space-y-2">
                {payment.refunds.map((refund) => (
                  <li
                    key={refund.id}
                    className="flex items-center justify-between rounded-lg border border-app-border-subtle px-3 py-2 text-sm">
                    <div>
                      <p className="font-mono text-xs text-app-text">
                        {refund.id}
                      </p>
                      <p className="mt-1 text-app-text-secondary">
                        {refund.reason ?? 'No provider reason'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-app-text">
                        {formatCurrencyCents(refund.amount, refund.currency)}
                      </p>
                      <p className="mt-1 text-xs text-app-text-muted">
                        {refund.status} · {formatDateTime(refund.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
            <h2 className="mb-3 text-sm font-medium text-app-text">Actions</h2>
            {canRefund ? (
              <RefundPaymentButton
                chargeId={payment.id}
                maxRefundableAmountCents={payment.refundableAmount}
                currency={payment.currency}
              />
            ) : (
              <p className="text-sm text-app-text-muted">
                {payment.refundableAmount <= 0
                  ? 'This payment is already fully refunded.'
                  : 'You do not have permission to issue refunds.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-app-text-muted">{label}</span>
      <span className={mono ? 'font-mono text-xs text-app-text' : 'text-app-text'}>
        {value}
      </span>
    </div>
  );
}

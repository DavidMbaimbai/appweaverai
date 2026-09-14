import Link from 'next/link';

import {
  AdminEmptyState,
  AdminPageHeader,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  listPayments,
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

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildPaymentsHref(params: {
  status?: string;
  query?: string;
  cursor?: string | null;
}) {
  const search = new URLSearchParams();

  if (params.status) search.set('status', params.status);
  if (params.query) search.set('q', params.query);
  if (params.cursor) search.set('cursor', params.cursor);

  const query = search.toString();
  return query ? `/admin/payments?${query}` : '/admin/payments';
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string; q?: string }>;
}) {
  const auth = await requireAdmin('payments:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const cursor = readParam(params.cursor);
  const status = readParam(params.status);
  const query = readParam(params.q);

  const result = await listPayments({ cursor, status, query });

  if (!result.configured) {
    return (
      <div>
        <AdminPageHeader
          title="Payments"
          description="Review Stripe charge activity and refunds."
        />
        <AdminEmptyState message={result.message ?? 'Stripe is not configured.'} />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Payments"
        description="Review Stripe charge activity and refunds."
      />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input
          theme="app"
          name="q"
          defaultValue={query}
          placeholder="Exact Stripe charge ID"
          className="w-72"
        />
        <Select theme="app" name="status" defaultValue={status ?? ''}>
          <option value="">All statuses</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
        </Select>
        <button
          type="submit"
          className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
          Filter
        </button>
      </form>

      {result.statusFilterMode === 'page' && result.statusFilter ? (
        <p className="mb-3 text-xs text-app-text-muted">
          Status filtering is applied to the current Stripe page only because
          Stripe charges do not support server-side status filters.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-left text-xs text-app-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Transaction</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {result.payments.map((payment) => (
              <tr
                key={payment.id}
                className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/payments/${payment.id}`}
                    className="font-mono text-xs text-app-text hover:underline">
                    {payment.providerTransactionId}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {payment.customerEmail ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {formatCurrencyCents(payment.amount, payment.currency)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={STATUS_TONE[payment.status]}>
                    {payment.status}
                  </StatusPill>
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {formatDateTime(payment.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {result.payments.length === 0 ? (
          <p className="p-8 text-center text-sm text-app-text-muted">
            No payments match the current filters.
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-app-text-secondary">
        <span>
          {query
            ? 'Showing an exact Stripe charge lookup.'
            : 'Stripe cursor pagination is shown newest-first.'}
        </span>
        <div className="flex gap-2">
          {cursor ? (
            <Link
              href={buildPaymentsHref({ status, query })}
              className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
              Reset
            </Link>
          ) : null}
          {result.nextCursor ? (
            <Link
              href={buildPaymentsHref({
                status,
                query,
                cursor: result.nextCursor,
              })}
              className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
              Next page
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

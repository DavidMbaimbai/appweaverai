import Link from 'next/link';

import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { getRevenueSummary } from '@/lib/admin/queries/revenue';
import { listSubscriptions } from '@/lib/admin/queries/subscriptions';
import { requireAdmin } from '@/lib/auth/require-admin';

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildSubscriptionsHref(params: {
  page?: number;
  q?: string;
  plan?: string;
  status?: string;
}) {
  const search = new URLSearchParams();

  if (params.page && params.page > 1) {
    search.set('page', `${params.page}`);
  }
  if (params.q) search.set('q', params.q);
  if (params.plan) search.set('plan', params.plan);
  if (params.status) search.set('status', params.status);

  const query = search.toString();
  return query ? `/admin/subscriptions?${query}` : '/admin/subscriptions';
}

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    plan?: string;
    status?: string;
  }>;
}) {
  const auth = await requireAdmin('subscriptions:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const page = Number(readParam(params.page)) || 1;
  const query = readParam(params.q);
  const plan = readParam(params.plan);
  const status = readParam(params.status);

  const [result, revenue] = await Promise.all([
    listSubscriptions({
      page,
      search: query,
      plan,
      status,
    }),
    getRevenueSummary(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div>
      <AdminPageHeader
        title="Subscriptions"
        description={`${formatNumber(result.total)} subscription records`}
      />

      {revenue.configured ? (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard
            label="Paying users"
            value={formatNumber(revenue.payingUsers)}
          />
          <KpiCard
            label="MRR"
            value={formatCurrencyCents(revenue.mrrCents ?? 0)}
            hint={revenue.planPriceLabel ?? undefined}
          />
          <KpiCard
            label="ARR"
            value={formatCurrencyCents(revenue.arrCents ?? 0)}
          />
          <KpiCard
            label="Refunds (30d)"
            value={formatCurrencyCents(revenue.refunds30dCents ?? 0)}
            hint="Best-effort single-page Stripe total"
          />
        </div>
      ) : (
        <div className="mb-6">
          <AdminEmptyState
            message={
              revenue.configError ??
              'Stripe is not configured, so revenue KPIs are unavailable.'
            }
          />
        </div>
      )}

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input
          theme="app"
          name="q"
          defaultValue={query}
          placeholder="Search by user, email, or subscription ID"
          className="w-80"
        />
        <Select theme="app" name="plan" defaultValue={plan ?? ''}>
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </Select>
        <Select theme="app" name="status" defaultValue={status ?? ''}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="canceled">Canceled</option>
          <option value="past_due">Past due</option>
          <option value="unpaid">Unpaid</option>
        </Select>
        <button
          type="submit"
          className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
          Filter
        </button>
      </form>

      {!result.stripeConfigured ? (
        <p className="mb-3 text-xs text-app-text-muted">
          Stripe is not configured, so period dates and live billing state are
          unavailable.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-left text-xs text-app-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Plan</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Billing cycle</th>
              <th className="px-4 py-2.5 font-medium">Current period end</th>
              <th className="px-4 py-2.5 font-medium">Trial end</th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((user) => {
              const live = user.liveSubscription;

              return (
                <tr
                  key={user.id}
                  className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/subscriptions/${user.id}`}
                      className="text-app-text hover:underline">
                      {user.name || user.username || user.email || user.id}
                    </Link>
                    <p className="text-xs text-app-text-muted">{user.email}</p>
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {user.subscriptionPlan}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill
                      tone={
                        (live?.status ?? user.subscriptionStatus) === 'active'
                          ? 'success'
                          : (live?.status ?? user.subscriptionStatus) ===
                              'trialing'
                            ? 'info'
                            : (live?.status ?? user.subscriptionStatus) ===
                                'past_due'
                              ? 'warning'
                              : 'neutral'
                      }>
                      {live?.status ?? user.subscriptionStatus ?? 'local_override'}
                    </StatusPill>
                    {live?.cancelAtPeriodEnd ? (
                      <p className="mt-1 text-xs text-amber-400">
                        Cancels at period end
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {live?.items[0]?.priceLabel
                      ? `${live.items[0].priceLabel}${
                          live.items[0].intervalLabel
                            ? ` / ${live.items[0].intervalLabel}`
                            : ''
                        }`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {live?.currentPeriodEnd
                      ? formatDateTime(live.currentPeriodEnd)
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {live?.trialEnd ? formatDateTime(live.trialEnd) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {result.users.length === 0 ? (
          <p className="p-8 text-center text-sm text-app-text-muted">
            No subscriptions match the current filters.
          </p>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-app-text-secondary">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildSubscriptionsHref({
                  page: page - 1,
                  q: query,
                  plan,
                  status,
                })}
                className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={buildSubscriptionsHref({
                  page: page + 1,
                  q: query,
                  plan,
                  status,
                })}
                className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

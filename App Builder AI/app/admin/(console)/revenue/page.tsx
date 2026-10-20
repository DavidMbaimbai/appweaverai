import {
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { requireAdmin } from '@/lib/auth/require-admin';
import { NOT_AVAILABLE } from '@/lib/marketing-credits/reports';
import { loadRevenueOverview } from '@/lib/revenue/overview';

export const dynamic = 'force-dynamic';

type Na = typeof NOT_AVAILABLE;
const money = (v: number | Na) => (v === NOT_AVAILABLE ? NOT_AVAILABLE : formatCurrencyCents(v));
const count = (v: number | Na) => (v === NOT_AVAILABLE ? NOT_AVAILABLE : formatNumber(v));
const pct = (v: number | Na) => (v === NOT_AVAILABLE ? NOT_AVAILABLE : `${(v * 100).toFixed(1)}%`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : NOT_AVAILABLE);

export default async function AdminRevenuePage() {
  const auth = await requireAdmin('revenue:read');
  if (!auth.ok) return null;
  const data = await loadRevenueOverview();
  const { kpis, margin } = data;
  const trend = data.trend;
  const maxTrend = Math.max(1, ...(trend ?? []).map((p) => p.mrrCents));

  return (
    <>
      <AdminPageHeader
        title="Revenue overview"
        description="Computed only from Stripe subscriptions and invoices synced by webhook. A figure shows “not available” when there is no data behind it. MRR uses list prices (discounts are not applied) and counts USD only."
      />
      {data.excludedCurrencies.length > 0 ? (
        <p className="mb-4 rounded-md bg-app-surface p-3 text-sm text-amber-400">
          Excluded from totals (non-USD): {data.excludedCurrencies.join(', ').toUpperCase()}
        </p>
      ) : null}

      <div className="space-y-8">
        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <KpiCard label="Current MRR" value={money(kpis.mrrCents)} />
          <KpiCard label="ARR run-rate" value={money(kpis.arrCents)} />
          <KpiCard label="Active subscriptions" value={count(kpis.activeSubscriptions)} />
          <KpiCard label="Paying customers" value={count(kpis.payingCustomers)} />
          <KpiCard label="Net revenue retention (30d)" value={pct(kpis.netRevenueRetention)} />
          <KpiCard label="Gross revenue churn (30d)" value={pct(kpis.grossRevenueChurn)} />
          <KpiCard label="Customer churn (30d)" value={pct(kpis.customerChurn)} />
          <KpiCard label="Credit-pack revenue (30d, net)" value={money(data.creditPacks.revenueCents)} />
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">MRR trend (12 months)</h2>
          {trend ? (
            <>
              <svg viewBox="0 0 120 40" className="h-32 w-full max-w-xl text-app-text" role="img" aria-label="MRR trend">
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  points={trend.map((p, i) => `${(i / Math.max(1, trend.length - 1)) * 118 + 1},${38 - (p.mrrCents / maxTrend) * 36}`).join(' ')}
                />
              </svg>
              <p className="text-xs text-app-text-muted">
                {trend[0]?.month}: {formatCurrencyCents(trend[0]?.mrrCents ?? 0)} → {trend.at(-1)?.month}:{' '}
                {formatCurrencyCents(trend.at(-1)?.mrrCents ?? 0)}
              </p>
            </>
          ) : (
            <p className="text-sm text-app-text-muted">{NOT_AVAILABLE}</p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">Plan mix</h2>
          {data.planMix && data.planMix.length > 0 ? (
            <table className="w-full text-left text-sm text-app-text">
              <thead className="text-xs text-app-text-muted"><tr><th>Plan</th><th>Subscriptions</th><th>MRR</th></tr></thead>
              <tbody>
                {data.planMix.map((row) => (
                  <tr key={row.planId} className="border-t border-app-border-subtle">
                    <td className="py-1">{row.planId}</td><td>{formatNumber(row.subscriptions)}</td><td>{formatCurrencyCents(row.mrrCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-app-text-muted">{NOT_AVAILABLE}</p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">Upcoming renewals (30 days)</h2>
          {data.renewals.length > 0 ? (
            <table className="w-full text-left text-sm text-app-text">
              <thead className="text-xs text-app-text-muted"><tr><th>Renews</th><th>Plan</th><th>MRR</th></tr></thead>
              <tbody>
                {data.renewals.map((r) => (
                  <tr key={r.id} className="border-t border-app-border-subtle">
                    <td className="py-1">{day(r.currentPeriodEnd)}</td><td>{r.planId ?? 'unknown'}</td><td>{formatCurrencyCents(r.mrrCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-app-text-muted">{NOT_AVAILABLE}</p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">Recent invoices</h2>
          {data.recentInvoices.length > 0 ? (
            <table className="w-full text-left text-sm text-app-text">
              <thead className="text-xs text-app-text-muted"><tr><th>Date</th><th>Number</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {data.recentInvoices.map((i) => (
                  <tr key={i.id} className="border-t border-app-border-subtle">
                    <td className="py-1">{day(i.stripeCreatedAt)}</td>
                    <td>{i.number ?? i.id}</td>
                    <td>{formatCurrencyCents(i.amountDueCents)} {i.currency.toUpperCase()}</td>
                    <td><StatusPill>{i.status}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-app-text-muted">{NOT_AVAILABLE}</p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-medium text-app-text">Provider cost vs revenue (last {margin.windowDays} days)</h2>
          <p className="text-xs text-app-text-muted">
            Internal provider costs only. Customer-facing credit ledgers are separate and never include these figures.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['Development AI', margin.development], ['Marketing', margin.marketing]] as const).map(([label, m]) => (
              <div key={label} className="rounded-md border border-app-border-subtle p-3 text-sm text-app-text">
                <p className="mb-2 font-medium">{label}</p>
                <p>Revenue: {money(m.revenueCents)}</p>
                <p>Provider cost: {money(m.providerCostCents)}</p>
                <p>Gross margin: {pct(m.grossMargin)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

import {
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { grantMarketingPromoAction, setOrgControlAction } from '@/lib/admin/actions/marketing';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { loadReport, NOT_AVAILABLE } from '@/lib/marketing-credits/reports';

export const dynamic = 'force-dynamic';

const input = 'rounded-md border border-app-border-subtle bg-app-bg px-2 py-1 text-sm text-app-text';
const button = 'rounded-md bg-app-text px-3 py-1 text-sm font-medium text-app-bg';
const cents = (v: number | typeof NOT_AVAILABLE) => (v === NOT_AVAILABLE ? NOT_AVAILABLE : formatCurrencyCents(v));

const sinceDays = (days: number) => new Date(Date.now() - days * 86_400_000);

export default async function MarketingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; notice?: string }>;
}) {
  const auth = await requireAdmin('marketing-reports:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'marketing-pricing:write');
  const canGrant = hasPermission(auth.admin.adminRole, 'credits:write');
  const params = await searchParams;
  const days = Math.min(365, Math.max(1, Number(params.days) || 30));
  const { summary, anomalies, controls } = await loadReport(sinceDays(days));

  return (
    <>
      <AdminPageHeader
        title="Marketing credit reports"
        description={`Customer marketing credits for the last ${days} days. Internal AppWeaver marketing spend is reported separately below and never counts as customer revenue.`}
      />
      {params.notice ? <p className="mb-4 rounded-md bg-app-surface p-3 text-sm text-app-text">{params.notice}</p> : null}

      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-base font-medium text-app-text">Customer marketing</h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="Credits purchased" value={formatNumber(summary.purchasedCredits)} />
            <KpiCard label="Credits consumed" value={formatNumber(summary.consumedCredits)} />
            <KpiCard label="Credits refunded" value={formatNumber(summary.refundedCredits)} />
            <KpiCard label="Failed / released ops" value={formatNumber(summary.failedOperations)} />
            <KpiCard label="Package revenue" value={formatCurrencyCents(summary.purchaseRevenueCents)} />
            <KpiCard label="Revenue from consumed credits" value={cents(summary.consumedRevenueCents)} />
            <KpiCard label="Provider cost" value={cents(summary.providerCostCents)} />
            <KpiCard label="Gross margin" value={cents(summary.grossMarginCents)} />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">Usage by operation</h2>
          <table className="w-full text-left text-sm text-app-text">
            <thead className="text-xs text-app-text-muted">
              <tr><th>Operation</th><th>Credits</th><th>Provider cost</th></tr>
            </thead>
            <tbody>
              {summary.byOperation.map((row) => (
                <tr key={row.operation} className="border-t border-app-border-subtle">
                  <td className="py-1">{row.operation}</td>
                  <td>{formatNumber(row.consumed)}</td>
                  <td>{cents(row.providerCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">Usage by organisation</h2>
          {anomalies.length > 0 ? (
            <p className="text-sm text-amber-400">
              Unusual consumption (24h): {anomalies.map((a) => `${a.orgId} (${a.consumed} vs ~${Math.round(a.baselineDaily)}/day)`).join(', ')}
            </p>
          ) : null}
          <table className="w-full text-left text-sm text-app-text">
            <thead className="text-xs text-app-text-muted">
              <tr><th>Organisation</th><th>Credits</th><th>Status</th></tr>
            </thead>
            <tbody>
              {summary.byOrg.slice(0, 50).map((row) => {
                const control = controls.find((c) => c.orgId === row.orgId);
                const flagged = anomalies.some((a) => a.orgId === row.orgId);
                return (
                  <tr key={row.orgId} className="border-t border-app-border-subtle">
                    <td className="py-1">{row.orgId}</td>
                    <td>{formatNumber(row.consumed)}</td>
                    <td className="space-x-1">
                      {control?.suspendedAt ? <StatusPill tone="danger">Suspended</StatusPill> : null}
                      {control?.monthlyLimit != null ? <StatusPill>limit {control.monthlyLimit}/mo</StatusPill> : null}
                      {flagged ? <StatusPill tone="warning">Anomaly</StatusPill> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-app-text">Internal marketing spend (AppWeaver house marketing)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard label="Estimated" value={formatCurrencyCents(summary.internal.totalEstimatedCents)} />
            <KpiCard label="Actual (estimate where not yet known)" value={formatCurrencyCents(summary.internal.totalActualCents)} />
          </div>
          <table className="w-full text-left text-sm text-app-text">
            <thead className="text-xs text-app-text-muted">
              <tr><th>Operation</th><th>Provider</th><th>Count</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {summary.internal.byOperation.map((row) => (
                <tr key={`${row.operation}${row.provider}`} className="border-t border-app-border-subtle">
                  <td className="py-1">{row.operation}</td>
                  <td>{row.provider}</td>
                  <td>{row.count}</td>
                  <td>{formatCurrencyCents(row.actualCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {canWrite ? (
          <section className="space-y-2">
            <h2 className="text-base font-medium text-app-text">Organisation controls</h2>
            <form action={setOrgControlAction} className="flex flex-wrap items-end gap-2">
              <input name="orgId" placeholder="Organisation id" required className={input} />
              <input name="monthlyLimit" type="number" min={0} placeholder="Monthly credit limit" className={input} />
              <label className="flex items-center gap-1 text-sm text-app-text">
                <input name="suspended" type="checkbox" /> Suspend marketing
              </label>
              <input name="reason" placeholder="Reason" required className={input} />
              <button className={button}>Save</button>
            </form>
          </section>
        ) : null}

        {canGrant ? (
          <section className="space-y-2">
            <h2 className="text-base font-medium text-app-text">Grant promo credits</h2>
            <form action={grantMarketingPromoAction} className="flex flex-wrap items-end gap-2">
              <input name="userId" placeholder="User id (wallet owner)" required className={input} />
              <input name="amount" type="number" min={1} placeholder="Credits" required className={input} />
              <input name="expiryDays" type="number" min={1} placeholder="Expires in days" className={input} />
              <input name="reason" placeholder="Reason" required className={input} />
              <button className={button}>Grant</button>
            </form>
          </section>
        ) : null}
      </div>
    </>
  );
}

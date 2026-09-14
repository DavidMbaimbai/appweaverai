import Link from 'next/link';
import {
  AdminPageHeader,
  KpiCard,
  StatusPill,
} from '@/components/admin/ui/primitives';
import {
  formatCurrencyCents,
  formatNumber,
} from '@/components/admin/ui/primitives';
import {
  getDashboardKpis,
  getDashboardTrends,
  resolveRangeFromParam,
} from '@/lib/admin/queries/dashboard';
import { getSystemHealthSnapshot } from '@/lib/admin/queries/system-health';
import { requireAdmin } from '@/lib/auth/require-admin';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin('dashboard:read');
  const { range: rangeParam } = await searchParams;
  const range = resolveRangeFromParam(rangeParam);

  const [kpis, trends, health] = await Promise.all([
    getDashboardKpis(range),
    getDashboardTrends(range),
    getSystemHealthSnapshot(),
  ]);

  const activeRange = rangeParam ?? '30d';
  const hasIncident = health.some((c) => c.status !== 'healthy');

  return (
    <div>
      <AdminPageHeader
        title="Dashboard"
        description="Consolidated platform KPIs across users, revenue, projects, and AI usage."
        actions={
          <div className="flex gap-1 rounded-full border border-app-border-subtle p-1">
            {RANGE_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={`/admin?range=${opt.value}`}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  activeRange === opt.value
                    ? 'bg-app-surface-active text-app-text'
                    : 'text-app-text-secondary hover:text-app-text',
                )}>
                {opt.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Total users"
          value={formatNumber(kpis.users.total)}
          hint={`+${formatNumber(kpis.users.new)} new`}
        />
        <KpiCard
          label="Active users"
          value={formatNumber(kpis.engagement.active)}
          hint={changeHint(kpis.engagement.activeChangePct)}
        />
        <KpiCard
          label="Paying users"
          value={formatNumber(kpis.users.paying)}
        />
        <KpiCard
          label="MRR"
          value={
            kpis.revenue.mrrCents != null
              ? formatCurrencyCents(kpis.revenue.mrrCents)
              : '—'
          }
          hint={
            kpis.revenue.arrCents != null
              ? `${formatCurrencyCents(kpis.revenue.arrCents)} ARR`
              : 'Stripe not configured'
          }
        />
        <KpiCard label="Projects" value={formatNumber(kpis.projects.total)} hint={`+${formatNumber(kpis.projects.new)} new`} />
        <KpiCard label="AI requests" value={formatNumber(kpis.aiUsage.requests)} />
        <KpiCard label="AI tokens" value={formatNumber(kpis.aiUsage.tokens)} />
        <KpiCard
          label="AI cost"
          value={formatCurrencyCents(kpis.aiUsage.costCents)}
          hint={changeHint(kpis.aiUsage.costChangePct)}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="text-sm font-medium text-app-text">New users</h2>
          <TrendBars series={trends.users} />
        </div>

        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-app-text">
              System status
            </h2>
            <Link
              href="/admin/system-health"
              className="text-xs text-app-accent-blue hover:underline">
              View details →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {health.map((component) => (
              <div
                key={component.name}
                className="flex items-center justify-between text-sm">
                <span className="text-app-text-secondary">
                  {component.name}
                </span>
                <StatusPill
                  tone={
                    component.status === 'healthy'
                      ? 'success'
                      : component.status === 'degraded'
                        ? 'warning'
                        : 'danger'
                  }>
                  {component.status}
                </StatusPill>
              </div>
            ))}
          </div>
          {hasIncident ? (
            <p className="mt-3 text-xs text-amber-400">
              One or more components need attention.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function changeHint(pct: number | null) {
  if (pct == null) return undefined;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}% vs previous period`;
}

function TrendBars({ series }: { series: { date: string; value: number }[] }) {
  if (series.length === 0) {
    return (
      <p className="mt-6 text-sm text-app-text-muted">
        No data for this period.
      </p>
    );
  }

  const max = Math.max(...series.map((s) => s.value), 1);

  return (
    <div className="mt-4 flex h-40 items-end gap-1">
      {series.map((point) => (
        <div
          key={point.date}
          className="group relative flex-1"
          title={`${point.date}: ${point.value}`}>
          <div
            className="w-full rounded-t bg-app-accent-blue/70 transition-colors group-hover:bg-app-accent-blue"
            style={{ height: `${Math.max((point.value / max) * 100, 2)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

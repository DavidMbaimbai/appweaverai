import Link from 'next/link';

import {
  AdminPageHeader,
  KpiCard,
  formatNumber,
} from '@/components/admin/ui/primitives';
import {
  getActiveUserCounts,
  getAiFeatureAdoption,
  getPeakUsageHours,
  getPlanDistribution,
  getRegistrationTrend,
} from '@/lib/admin/queries/analytics';
import { resolveRangeFromParam } from '@/lib/admin/queries/dashboard';
import { requireAdmin } from '@/lib/auth/require-admin';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  builder: 'Builder',
  pro: 'Pro',
  business: 'Business',
};

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const auth = await requireAdmin('analytics:read');
  if (!auth.ok) return null;

  const { range: rangeParam } = await searchParams;
  const range = resolveRangeFromParam(rangeParam);
  const activeRange = rangeParam ?? '30d';

  const [activeUsers, registrations, plans, aiAdoption, peakUsage] =
    await Promise.all([
      getActiveUserCounts(),
      getRegistrationTrend(range),
      getPlanDistribution(),
      getAiFeatureAdoption(range),
      getPeakUsageHours(range),
    ]);

  return (
    <div>
      <AdminPageHeader
        title="Analytics"
        description="Deeper product and usage analytics beyond AI Usage and Dashboard."
        actions={
          <div className="flex gap-1 rounded-full border border-app-border-subtle p-1">
            {RANGE_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={`/admin/analytics?range=${opt.value}`}
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Daily active users" value={formatNumber(activeUsers.dau)} hint="Last 24 hours" />
        <KpiCard label="Weekly active users" value={formatNumber(activeUsers.wau)} hint="Last 7 days" />
        <KpiCard label="Monthly active users" value={formatNumber(activeUsers.mau)} hint="Last 30 days" />
        <KpiCard
          label="New signups"
          value={formatNumber(registrations.totalNew)}
          hint={`${registrations.avgPerDay}/day avg`}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4 lg:col-span-2">
          <h2 className="text-sm font-medium text-app-text">
            New signups per day
          </h2>
          <p className="text-xs text-app-text-muted">
            Daily registrations in the selected period.
          </p>
          <TrendBars series={registrations.daily} />
        </div>

        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="text-sm font-medium text-app-text">
            Cumulative registered users
          </h2>
          <p className="text-xs text-app-text-muted">
            Running total of all registered users.
          </p>
          <LineChart series={registrations.cumulative} />
          <p className="mt-2 text-xs text-app-text-muted">
            {registrations.cumulative.length > 0
              ? `${formatNumber(
                  registrations.cumulative[registrations.cumulative.length - 1]
                    .value,
                )} total registered users by end of period`
              : 'No signups in this period.'}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="text-sm font-medium text-app-text">
            Plan distribution
          </h2>
          <p className="text-xs text-app-text-muted">All-time, all users.</p>
          <div className="mt-4 space-y-3">
            {plans.map((plan) => (
              <div key={plan.plan}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text-secondary">
                    {PLAN_LABELS[plan.plan] ?? plan.plan}
                  </span>
                  <span className="text-app-text-muted">
                    {formatNumber(plan.count)} ({plan.pct}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-app-surface-active">
                  <div
                    className="h-1.5 rounded-full bg-app-accent-blue"
                    style={{ width: `${Math.max(plan.pct, 2)}%` }}
                  />
                </div>
              </div>
            ))}
            {plans.length === 0 ? (
              <p className="text-sm text-app-text-muted">No users yet.</p>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4 lg:col-span-2">
          <h2 className="text-sm font-medium text-app-text">
            AI feature adoption
          </h2>
          <p className="text-xs text-app-text-muted">
            Top AI providers/models by usage in this period.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-app-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-app-surface-active/40 text-left text-xs text-app-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Requests</th>
                  <th className="px-3 py-2 font-medium">Unique users</th>
                </tr>
              </thead>
              <tbody>
                {aiAdoption.map((row) => (
                  <tr
                    key={`${row.provider}-${row.model}`}
                    className="border-t border-app-border-subtle">
                    <td className="px-3 py-2 text-app-text">{row.provider}</td>
                    <td className="px-3 py-2 text-app-text-secondary">
                      {row.model}
                    </td>
                    <td className="px-3 py-2 text-app-text-secondary">
                      {formatNumber(row.requests)}
                    </td>
                    <td className="px-3 py-2 text-app-text-secondary">
                      {formatNumber(row.uniqueUsers)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {aiAdoption.length === 0 ? (
              <p className="p-6 text-center text-sm text-app-text-muted">
                No AI usage in this period.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="text-sm font-medium text-app-text">
            Peak usage hours
          </h2>
          <p className="text-xs text-app-text-muted">
            AI request volume by hour of day (UTC).
          </p>
          <HourlyBars series={peakUsage.hourly} />
          <p className="mt-2 text-xs text-app-text-muted">
            {peakUsage.peakRequests > 0
              ? `Busiest hour: ${String(peakUsage.peakHour).padStart(2, '0')}:00 UTC (${formatNumber(peakUsage.peakRequests)} requests)`
              : 'No AI usage in this period.'}
          </p>
        </div>
      </div>
    </div>
  );
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

function LineChart({ series }: { series: { date: string; value: number }[] }) {
  if (series.length === 0) {
    return (
      <p className="mt-6 text-sm text-app-text-muted">
        No data for this period.
      </p>
    );
  }

  const width = 300;
  const height = 140;
  const padding = 8;
  const values = series.map((s) => s.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const spread = Math.max(max - min, 1);

  const points = series.map((point, i) => {
    const x =
      series.length === 1
        ? width / 2
        : padding + (i / (series.length - 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      ((point.value - min) / spread) * (height - padding * 2);
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - padding} L${points[0].x.toFixed(1)},${height - padding} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-4 h-40 w-full"
      preserveAspectRatio="none">
      <path d={areaPath} fill="var(--app-accent-blue, #3b82f6)" opacity="0.12" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--app-accent-blue, #3b82f6)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle
          key={series[i].date}
          cx={p.x}
          cy={p.y}
          r="2"
          fill="var(--app-accent-blue, #3b82f6)">
          <title>{`${series[i].date}: ${series[i].value}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function HourlyBars({ series }: { series: { hour: number; value: number }[] }) {
  const max = Math.max(...series.map((s) => s.value), 1);

  return (
    <div className="mt-4 flex h-32 items-end gap-0.5">
      {series.map((point) => (
        <div
          key={point.hour}
          className="group relative flex-1"
          title={`${String(point.hour).padStart(2, '0')}:00 — ${point.value} requests`}>
          <div
            className="w-full rounded-t bg-app-accent-orange/70 transition-colors group-hover:bg-app-accent-orange"
            style={{ height: `${Math.max((point.value / max) * 100, 2)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

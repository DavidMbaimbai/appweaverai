import Link from 'next/link';

import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import {
  getApiPerformanceMetrics,
  getCriticalErrorFeed,
  getDeploymentHealth,
  getSystemHealthSnapshot,
} from '@/lib/admin/queries/system-health';
import { resolveRangeFromParam } from '@/lib/admin/queries/dashboard';
import { requireAdmin } from '@/lib/auth/require-admin';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const auth = await requireAdmin('system_health:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const activeRange = RANGE_OPTIONS.some((option) => option.value === params.range)
    ? params.range
    : '30d';
  const range = resolveRangeFromParam(activeRange);

  const [healthSnapshot, apiMetrics, deploymentHealth, criticalErrors] =
    await Promise.all([
      getSystemHealthSnapshot(),
      getApiPerformanceMetrics(range),
      getDeploymentHealth(range),
      getCriticalErrorFeed(),
    ]);

  const healthyCount = healthSnapshot.filter((item) => item.status === 'healthy').length;
  const degradedCount = healthSnapshot.filter((item) => item.status === 'degraded').length;
  const unavailableCount = healthSnapshot.filter(
    (item) => item.status === 'unavailable',
  ).length;
  const liveDeployments = countStatus(deploymentHealth.statusBreakdown, 'LIVE');
  const inFlightDeployments = deploymentHealth.statusBreakdown
    .filter((entry) =>
      ['PENDING', 'PROVISIONING', 'BUILDING', 'BUNDLING', 'PROMOTING'].includes(
        entry.status,
      ),
    )
    .reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div>
      <AdminPageHeader
        title="System Health"
        description="Operational view of dependency health, AI-backed performance telemetry, deployment failures, and recent critical issues."
        actions={
          <div className="flex gap-1 rounded-full border border-app-border-subtle p-1">
            {RANGE_OPTIONS.map((option) => (
              <Link
                key={option.value}
                href={`/admin/system-health?range=${option.value}`}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  activeRange === option.value
                    ? 'bg-app-surface-active text-app-text'
                    : 'text-app-text-secondary hover:text-app-text',
                )}>
                {option.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Healthy checks" value={formatNumber(healthyCount)} />
        <KpiCard label="Degraded checks" value={formatNumber(degradedCount)} />
        <KpiCard label="Unavailable checks" value={formatNumber(unavailableCount)} />
        <KpiCard
          label="Open incidents"
          value={formatNumber(degradedCount + unavailableCount)}
          hint={
            degradedCount + unavailableCount > 0
              ? 'Investigate the highlighted services below'
              : 'No active incidents detected'
          }
        />
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-app-text">Dependency snapshot</h2>
            <p className="mt-1 text-sm text-app-text-secondary">
              Live checks mirror the dashboard widget, with more operational detail.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {healthSnapshot.map((component) => (
            <div
              key={component.name}
              className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-app-text">{component.name}</h3>
                  <p className="mt-1 text-xs text-app-text-muted">
                    Last checked{' '}
                    {component.checkedAt
                      ? formatDateTime(component.checkedAt)
                      : 'just now'}
                  </p>
                </div>
                <StatusPill tone={healthTone(component.status)}>
                  {component.status}
                </StatusPill>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-app-text-secondary">Latency</dt>
                  <dd className="text-app-text">
                    {component.latencyMs != null
                      ? `${formatNumber(component.latencyMs)} ms`
                      : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-app-text-secondary">Detail</dt>
                  <dd className="text-right text-app-text">
                    {component.detail ?? 'Operational'}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-app-text">API / AI performance</h2>
          <p className="mt-1 text-sm text-app-text-secondary">
            This app does not yet store full request-level APM. These metrics
            approximate production latency and failures using available AI request
            telemetry (`AiUsageEvent.latencyMs`) plus the live checks above.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Requests"
            value={formatNumber(apiMetrics.requestCount)}
            hint={`${formatNumber(apiMetrics.successCount)} succeeded`}
          />
          <KpiCard
            label="Error rate"
            value={formatPercent(apiMetrics.errorRatePct)}
            hint={`${formatNumber(apiMetrics.failureCount)} failures`}
          />
          <KpiCard
            label="Avg latency"
            value={formatLatency(apiMetrics.latencyMs.average)}
          />
          <KpiCard
            label="Min latency"
            value={formatLatency(apiMetrics.latencyMs.minimum)}
          />
          <KpiCard
            label="Max latency"
            value={formatLatency(apiMetrics.latencyMs.maximum)}
          />
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-app-text">Deployment health</h2>
          <p className="mt-1 text-sm text-app-text-secondary">
            Release 1 monitoring is based on deployment status telemetry currently in
            the schema. Failure-reason categorization is limited until richer build
            failure metadata is captured.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard
            label="Deployments"
            value={formatNumber(deploymentHealth.total)}
            hint={`${activeRange} window`}
          />
          <KpiCard
            label="Failed"
            value={formatNumber(deploymentHealth.failureCount)}
          />
          <KpiCard
            label="Live"
            value={formatNumber(liveDeployments)}
          />
          <KpiCard
            label="In flight"
            value={formatNumber(inFlightDeployments)}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[320px,1fr]">
          <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
            <h3 className="text-sm font-medium text-app-text">Status breakdown</h3>
            <div className="mt-4 space-y-3">
              {deploymentHealth.statusBreakdown.length > 0 ? (
                deploymentHealth.statusBreakdown.map((entry) => (
                  <div
                    key={entry.status}
                    className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <StatusPill tone={deploymentTone(entry.status)}>
                        {entry.status}
                      </StatusPill>
                    </div>
                    <span className="text-app-text">{formatNumber(entry.count)}</span>
                  </div>
                ))
              ) : (
                <AdminEmptyState message="No deployments found for this period." />
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-app-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-app-surface text-left text-xs text-app-text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Version</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Domain</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {deploymentHealth.recentFailedDeployments.map((deployment) => (
                  <tr
                    key={deployment.id}
                    className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/projects/${deployment.projectId}`}
                        className="text-app-accent-blue hover:underline">
                        {deployment.projectName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      v{deployment.version}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatLabel(deployment.deploymentType)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-app-text-secondary">
                      {deployment.domain}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatDateTime(deployment.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {deploymentHealth.recentFailedDeployments.length === 0 ? (
              <p className="p-8 text-center text-sm text-app-text-muted">
                No failed deployments in this range.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-app-text">Critical error feed</h2>
          <p className="mt-1 text-sm text-app-text-secondary">
            Sanitized union of recent AI provider failures and failed deployments.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-app-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Message / category</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {criticalErrors.map((item) => (
                <tr
                  key={`${item.type}-${item.id}`}
                  className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                  <td className="px-4 py-2.5">
                    <StatusPill
                      tone={item.type === 'DEPLOYMENT_FAILURE' ? 'danger' : 'warning'}>
                      {item.type === 'DEPLOYMENT_FAILURE'
                        ? 'Deployment failure'
                        : 'AI failure'}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {item.projectId ? (
                      <Link
                        href={`/admin/projects/${item.projectId}`}
                        className="text-app-accent-blue hover:underline">
                        {item.source}
                      </Link>
                    ) : (
                      item.source
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {item.message}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {formatDateTime(item.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {criticalErrors.length === 0 ? (
            <p className="p-8 text-center text-sm text-app-text-muted">
              No recent critical errors detected.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function countStatus(
  breakdown: Array<{ status: string; count: number }>,
  status: string,
) {
  return breakdown.find((entry) => entry.status === status)?.count ?? 0;
}

function healthTone(status: 'healthy' | 'degraded' | 'unavailable') {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
}

function deploymentTone(status: string) {
  if (status === 'LIVE') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'SUPERSEDED') return 'neutral';
  return 'info';
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatLatency(value: number | null) {
  return value == null ? '—' : `${formatNumber(value)} ms`;
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

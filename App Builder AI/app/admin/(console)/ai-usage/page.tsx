import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { AiUsageFilters } from '@/components/admin/ai-usage/ai-usage-filters';
import { AiUsageNav } from '@/components/admin/ai-usage/ai-usage-nav';
import {
  getAiUsageByPlan,
  getAiUsageDashboard,
} from '@/lib/admin/queries/ai-usage';
import { resolveRangeFromParam } from '@/lib/admin/queries/dashboard';
import { requireAdmin } from '@/lib/auth/require-admin';

type PageSearchParams = Promise<{
  range?: string | string[];
  provider?: string | string[];
  model?: string | string[];
}>;

export default async function Page({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const auth = await requireAdmin('ai_usage:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const rangeParam = readSingleParam(params.range) ?? '30d';
  const provider = readSingleParam(params.provider);
  const model = readSingleParam(params.model);
  const range = resolveRangeFromParam(rangeParam);

  const [dashboard, planBreakdown] = await Promise.all([
    getAiUsageDashboard(range, { provider, model }),
    getAiUsageByPlan(range, { provider, model }),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="AI usage"
        description="Operational visibility into request volume, token consumption, latency, and cost."
      />

      <AiUsageNav
        active="overview"
        query={{ range: rangeParam, provider, model }}
      />

      <AiUsageFilters
        basePath="/admin/ai-usage"
        activeRange={rangeParam}
        provider={provider}
        model={model}
        availableProviders={dashboard.availableProviders}
        availableModels={dashboard.availableModels}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <KpiCard
          label="Total requests"
          value={formatNumber(dashboard.summary.totalRequests)}
        />
        <KpiCard
          label="Successful requests"
          value={formatNumber(dashboard.summary.successfulRequests)}
          hint={
            dashboard.summary.successRatePct != null
              ? `${dashboard.summary.successRatePct}% success rate`
              : undefined
          }
        />
        <KpiCard
          label="Failed requests"
          value={formatNumber(dashboard.summary.failedRequests)}
        />
        <KpiCard
          label="Input tokens"
          value={formatNumber(dashboard.summary.inputTokens)}
        />
        <KpiCard
          label="Output tokens"
          value={formatNumber(dashboard.summary.outputTokens)}
        />
        <KpiCard
          label="Total tokens"
          value={formatNumber(dashboard.summary.totalTokens)}
        />
        <KpiCard
          label="Total cost"
          value={formatCurrencyCents(dashboard.summary.totalCostCents)}
        />
        <KpiCard
          label="Average latency"
          value={
            dashboard.summary.averageLatencyMs != null
              ? `${formatNumber(dashboard.summary.averageLatencyMs)} ms`
              : '—'
          }
        />
      </div>

      <div className="mt-8 rounded-xl border border-app-border-subtle bg-app-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border-subtle px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-app-text">
              Provider and model breakdown
            </h2>
            <p className="mt-1 text-xs text-app-text-muted">
              Top 50 provider/model combinations by AI cost in the selected
              window.
            </p>
          </div>
        </div>

        {dashboard.breakdown.length === 0 ? (
          <div className="p-4">
            <AdminEmptyState message="No AI usage matched the selected filters." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-app-surface text-left text-xs text-app-text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Requests</th>
                  <th className="px-4 py-2.5 font-medium">Tokens</th>
                  <th className="px-4 py-2.5 font-medium">Cost</th>
                  <th className="px-4 py-2.5 font-medium">Avg latency</th>
                  <th className="px-4 py-2.5 font-medium">Success rate</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.breakdown.map((row) => (
                  <tr
                    key={`${row.provider}:${row.model}`}
                    className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                    <td className="px-4 py-2.5 text-app-text">{row.provider}</td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      <div className="max-w-[28rem] truncate" title={row.model}>
                        {row.model}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      <div>{formatNumber(row.requests)}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <StatusPill tone="success">
                          {formatNumber(row.successfulRequests)} ok
                        </StatusPill>
                        {row.failedRequests > 0 ? (
                          <StatusPill tone="danger">
                            {formatNumber(row.failedRequests)} failed
                          </StatusPill>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      <div>{formatNumber(row.totalTokens)}</div>
                      <div className="text-xs text-app-text-muted">
                        {formatNumber(row.inputTokens)} in /{' '}
                        {formatNumber(row.outputTokens)} out
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatCurrencyCents(row.totalCostCents)}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {row.averageLatencyMs != null
                        ? `${formatNumber(row.averageLatencyMs)} ms`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {row.successRatePct != null ? `${row.successRatePct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8 rounded-xl border border-app-border-subtle bg-app-surface">
        <div className="border-b border-app-border-subtle px-4 py-3">
          <h2 className="text-sm font-medium text-app-text">
            Cost by subscription plan
          </h2>
          <p className="mt-1 text-xs text-app-text-muted">
            Two-step rollup across the most active users in the selected window,
            capped at {formatNumber(planBreakdown.cappedUserCount)} users.
          </p>
        </div>

        {planBreakdown.plans.length === 0 ? (
          <div className="p-4">
            <AdminEmptyState message="No user-attributed AI activity was available for plan rollups." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-app-surface text-left text-xs text-app-text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Active users</th>
                  <th className="px-4 py-2.5 font-medium">Requests</th>
                  <th className="px-4 py-2.5 font-medium">Tokens</th>
                  <th className="px-4 py-2.5 font-medium">Total cost</th>
                  <th className="px-4 py-2.5 font-medium">Avg cost / user</th>
                </tr>
              </thead>
              <tbody>
                {planBreakdown.plans.map((row) => (
                  <tr
                    key={row.plan}
                    className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                    <td className="px-4 py-2.5 text-app-text">{row.plan}</td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatNumber(row.activeUsers)}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatNumber(row.requests)}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatNumber(row.totalTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatCurrencyCents(row.totalCostCents)}
                    </td>
                    <td className="px-4 py-2.5 text-app-text-secondary">
                      {formatCurrencyCents(row.averageCostCentsPerActiveUser)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function readSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

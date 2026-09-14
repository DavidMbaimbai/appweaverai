import Link from 'next/link';

import {
  AdminEmptyState,
  AdminPageHeader,
  formatCurrencyCents,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { AiUsageFilters } from '@/components/admin/ai-usage/ai-usage-filters';
import { AiUsageNav } from '@/components/admin/ai-usage/ai-usage-nav';
import {
  getAiUsageByUser,
  getAiUsageFilterOptions,
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

  const [rows, filterOptions] = await Promise.all([
    getAiUsageByUser(range, { provider, model }),
    getAiUsageFilterOptions(range, provider),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="AI cost by user"
        description="Top 50 users by AI spend in the selected date range."
      />

      <AiUsageNav active="users" query={{ range: rangeParam, provider, model }} />

      <AiUsageFilters
        basePath="/admin/ai-usage/users"
        activeRange={rangeParam}
        provider={provider}
        model={model}
        availableProviders={filterOptions.providers}
        availableModels={filterOptions.models}
      />

      {rows.length === 0 ? (
        <AdminEmptyState message="No user-attributed AI usage matched the selected filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-app-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 font-medium">Requests</th>
                <th className="px-4 py-2.5 font-medium">Tokens</th>
                <th className="px-4 py-2.5 font-medium">Cost</th>
                <th className="px-4 py-2.5 font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.userId ?? `anonymous-${row.name}`}
                  className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                  <td className="px-4 py-2.5">
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="text-app-text hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      <span className="text-app-text">{row.name}</span>
                    )}
                    <p className="text-xs text-app-text-muted">
                      {row.email ?? row.userId ?? 'No linked account'}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {row.subscriptionPlan ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {formatNumber(row.requests)}
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
                    {row.creditBalance != null ? formatNumber(row.creditBalance) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function readSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

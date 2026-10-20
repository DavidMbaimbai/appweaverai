import Link from 'next/link';

import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { getObservatoryDashboard, listObservatory } from '@/lib/observatory/queries';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';

type Params = {
  q?: string;
  status?: string;
  deployment?: string;
  health?: string;
  complaints?: string;
  page?: string;
};

export default async function ObservatoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const auth = await requireAdmin('observatory:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const [dashboard, list] = await Promise.all([
    getObservatoryDashboard(),
    listObservatory({ ...params, page: Math.max(1, Number(params.page) || 1) }),
  ]);
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div>
      <AdminPageHeader
        title="Application Observatory"
        description="Read-only view of customer apps. Opening a project is recorded in the access log."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Apps" value={formatNumber(dashboard.apps)} />
        <KpiCard label="Deployed" value={formatNumber(dashboard.deployed)} />
        <KpiCard label="Unhealthy" value={formatNumber(dashboard.unhealthy)} hint="Latest health check failing (7d)" />
        <KpiCard label="Failing smoke" value={formatNumber(dashboard.failingSmoke)} hint="Latest smoke not passing (7d)" />
        <KpiCard label="Unresolved complaints" value={formatNumber(dashboard.unresolvedComplaints)} />
        <KpiCard label="Pending AI drafts" value={formatNumber(dashboard.pendingDrafts)} />
        <KpiCard label="Fixes awaiting verification" value={formatNumber(dashboard.awaitingVerification)} />
        <KpiCard
          label="Avg response time"
          value={dashboard.avgResponseHours === null ? 'Not measured' : `${dashboard.avgResponseHours} h`}
          hint={`${dashboard.measuredReplies} measured replies (8 weeks)`}
        />
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="mb-2 text-sm font-medium text-app-text">Top recurring issues</h2>
          {dashboard.topRecurring.length ? (
            <ul className="space-y-1 text-sm text-app-text-secondary">
              {dashboard.topRecurring.map((t) => (
                <li key={t.topic}>
                  {t.topic} <span className="text-app-text-muted">× {t.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-app-text-muted">No topic has repeated negative feedback.</p>
          )}
        </div>
        <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
          <h2 className="mb-2 text-sm font-medium text-app-text">Sentiment trend (weekly)</h2>
          <table className="w-full text-xs text-app-text-secondary">
            <thead className="text-left text-app-text-muted">
              <tr>
                <th className="py-1 font-medium">Week of</th>
                <th className="font-medium">+</th>
                <th className="font-medium">~</th>
                <th className="font-medium">−</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.sentimentTrend.map((w) => (
                <tr key={w.weekStart.toISOString()}>
                  <td className="py-0.5">{w.weekStart.toISOString().slice(0, 10)}</td>
                  <td>{w.positive}</td>
                  <td>{w.neutral}</td>
                  <td>{w.negative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input theme="app" name="q" defaultValue={params.q} placeholder="Search name, slug, ID or owner" className="w-72" />
        <Select theme="app" name="status" defaultValue={params.status ?? ''}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
        <Select theme="app" name="deployment" defaultValue={params.deployment ?? ''}>
          <option value="">Any deployment</option>
          <option value="LIVE">Live</option>
          <option value="FAILED">Failed</option>
          <option value="NONE">Not deployed</option>
        </Select>
        <Select theme="app" name="health" defaultValue={params.health ?? ''}>
          <option value="">Any health</option>
          <option value="healthy">Healthy</option>
          <option value="unhealthy">Unhealthy</option>
        </Select>
        <Select theme="app" name="complaints" defaultValue={params.complaints ?? ''}>
          <option value="">Any complaints</option>
          <option value="open">Open complaints</option>
        </Select>
        <button type="submit" className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        {list.rows.length ? (
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Deployment</th>
                <th className="px-4 py-2.5 font-medium">Health</th>
                <th className="px-4 py-2.5 font-medium">Complaints</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id} className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/observatory/${row.id}`} className="text-app-text hover:underline">
                      {row.name}
                    </Link>
                    <p className="font-mono text-xs text-app-text-muted">{row.id}</p>
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">{row.ownerName || row.ownerEmail || 'Unknown'}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={row.adminStatus === 'ACTIVE' ? 'success' : 'warning'}>{row.adminStatus}</StatusPill>
                  </td>
                  <td className="px-4 py-2.5">
                    {row.deploymentStatus ? (
                      <StatusPill tone={row.deploymentStatus === 'LIVE' ? 'success' : row.deploymentStatus === 'FAILED' ? 'danger' : 'info'}>
                        {row.deploymentStatus} v{row.deploymentVersion}
                      </StatusPill>
                    ) : (
                      <span className="text-app-text-muted">None</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={row.health === 'healthy' ? 'success' : row.health === 'unhealthy' ? 'danger' : 'neutral'}>
                      {row.health}
                    </StatusPill>
                    {row.smoke && row.smoke !== 'PASS' ? (
                      <StatusPill tone={row.smoke === 'CONFIRMED_FAILURE' ? 'danger' : 'warning'} className="ml-1">
                        smoke {row.smoke.toLowerCase().replace('_', ' ')}
                      </StatusPill>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">{row.openComplaints}</td>
                  <td className="px-4 py-2.5 text-app-text-secondary">{formatDateTime(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4">
            <AdminEmptyState message="No projects match these filters." />
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-app-text-secondary">
          <span>
            Page {list.page} of {totalPages} · {formatNumber(list.total)} projects
          </span>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link href={pageHref(params, list.page - 1)} className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Previous
              </Link>
            ) : null}
            {list.page < totalPages ? (
              <Link href={pageHref(params, list.page + 1)} className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function pageHref(params: Params, page: number) {
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'deployment', 'health', 'complaints'] as const) {
    if (params[key]) query.set(key, params[key]!);
  }
  query.set('page', String(page));
  return `/admin/observatory?${query.toString()}`;
}

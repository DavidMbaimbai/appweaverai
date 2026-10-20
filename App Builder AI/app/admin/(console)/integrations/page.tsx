import { IntegrationToggle } from '@/components/admin/integrations/integration-toggle';
import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminIntegrationOverview } from '@/lib/integrations/admin';

export default async function Page() {
  const auth = await requireAdmin('integrations:read');
  if (!auth.ok) return null;

  const overview = await getAdminIntegrationOverview();
  const canWrite = hasPermission(auth.admin.adminRole, 'integrations:write');
  const available = overview.rows.filter((r) => r.status === 'available');
  const soon = overview.rows.filter((r) => r.status !== 'available');
  const totals = available.reduce(
    (acc, r) => ({
      connected: acc.connected + r.connected,
      down: acc.down + r.down,
      degraded: acc.degraded + r.degraded,
      failures: acc.failures + r.failures7d,
    }),
    { connected: 0, down: 0, degraded: 0, failures: 0 },
  );

  return (
    <div>
      <AdminPageHeader
        title="Integrations"
        description="Connections, health and failures across all projects. No credentials are shown here. Disabling an integration blocks new connections and proxy calls."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard label="Connections" value={formatNumber(totals.connected)} />
        <KpiCard label="Down" value={formatNumber(totals.down)} />
        <KpiCard label="Degraded" value={formatNumber(totals.degraded)} />
        <KpiCard label="Failed checks (7 days)" value={formatNumber(totals.failures)} />
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-app-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-left text-xs text-app-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Integration</th>
              <th className="px-3 py-2 font-medium">Connected</th>
              <th className="px-3 py-2 font-medium">Healthy</th>
              <th className="px-3 py-2 font-medium">Degraded / down</th>
              <th className="px-3 py-2 font-medium">Usage</th>
              <th className="px-3 py-2 font-medium">Failed checks 7d</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {canWrite ? <th className="px-3 py-2 font-medium" /> : null}
            </tr>
          </thead>
          <tbody>
            {available.map((row) => (
              <tr key={row.id} className="border-t border-app-border-subtle align-top">
                <td className="px-3 py-2">
                  <div>{row.name}</div>
                  <div className="text-xs text-app-text-muted">{row.category}</div>
                </td>
                <td className="px-3 py-2">{row.connected}</td>
                <td className="px-3 py-2">{row.healthy}</td>
                <td className="px-3 py-2">
                  {row.degraded} / {row.down}
                </td>
                <td className="px-3 py-2">{formatNumber(row.usageCount)}</td>
                <td className="px-3 py-2">
                  {row.failures7d}
                  <span className="text-xs text-app-text-muted"> of {row.checks7d}</span>
                </td>
                <td className="px-3 py-2">
                  <StatusPill tone={row.disabled ? 'danger' : 'success'}>{row.disabled ? 'Disabled' : 'Enabled'}</StatusPill>
                  {row.disabledReason ? <div className="mt-1 text-xs text-app-text-muted">{row.disabledReason}</div> : null}
                </td>
                {canWrite ? (
                  <td className="px-3 py-2">
                    <IntegrationToggle integrationId={row.id} disabled={row.disabled} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-medium">Recent failed health checks</h2>
      {overview.recentFailures.length ? (
        <div className="mb-6 overflow-hidden rounded-xl border border-app-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Integration</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentFailures.map((f) => (
                <tr key={f.id} className="border-t border-app-border-subtle align-top">
                  <td className="px-3 py-2 text-app-text-secondary">{formatDateTime(f.createdAt)}</td>
                  <td className="px-3 py-2">{f.integrationId}</td>
                  <td className="px-3 py-2">{f.project}</td>
                  <td className="px-3 py-2 text-app-text-secondary">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mb-6">
          <AdminEmptyState message="No failed health checks in the last 7 days." />
        </div>
      )}

      <div className="mb-6 rounded-xl border border-app-border-subtle p-4 text-sm text-app-text-secondary">
        Outbound webhook deliveries (7 days): {overview.webhooks.SUCCESS ?? 0} delivered, {overview.webhooks.PENDING ?? 0}{' '}
        pending/retrying, {overview.webhooks.FAILED ?? 0} failed.
      </div>

      <p className="text-xs text-app-text-muted">Coming soon (not connectable): {soon.map((s) => s.name).join(', ')}.</p>
    </div>
  );
}

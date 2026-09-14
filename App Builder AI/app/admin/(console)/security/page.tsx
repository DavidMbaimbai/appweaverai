import {
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { listSecurityEvents } from '@/lib/admin/queries/security';
import { requireAdmin } from '@/lib/auth/require-admin';
import { Select } from '@/components/ui/select';
import { formatLocationFromJson } from '@/lib/geo/ip-lookup';

const SEVERITY_TONE = {
  INFO: 'neutral',
  WARNING: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
} as const;

export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; type?: string; page?: string }>;
}) {
  await requireAdmin('security:read');
  const params = await searchParams;
  const page = Number(params.page) || 1;

  const { events, total, bySeverity } = await listSecurityEvents({
    severity: params.severity,
    type: params.type,
    page,
  });

  const countFor = (severity: string) =>
    bySeverity.find((s) => s.severity === severity)?._count._all ?? 0;

  return (
    <div>
      <AdminPageHeader
        title="Security Events"
        description={`${total} events recorded`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Critical (30d)" value={String(countFor('CRITICAL'))} />
        <KpiCard label="High (30d)" value={String(countFor('HIGH'))} />
        <KpiCard label="Warning (30d)" value={String(countFor('WARNING'))} />
        <KpiCard label="Info (30d)" value={String(countFor('INFO'))} />
      </div>

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Select theme="app" name="severity" defaultValue={params.severity ?? ''}>
          <option value="">All severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="WARNING">Warning</option>
          <option value="INFO">Info</option>
        </Select>
        <button
          type="submit"
          className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-left text-xs text-app-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Severity</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Message</th>
              <th className="px-4 py-2.5 font-medium">Location</th>
              <th className="px-4 py-2.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-app-border-subtle">
                <td className="px-4 py-2.5">
                  <StatusPill tone={SEVERITY_TONE[event.severity]}>
                    {event.severity}
                  </StatusPill>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-app-text">
                  {event.type}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {event.message}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {formatLocationFromJson(event.metadata) ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {formatDateTime(event.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-app-text-muted">
            No security events match these filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}

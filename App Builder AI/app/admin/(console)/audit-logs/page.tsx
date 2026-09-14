import {
  AdminPageHeader,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { listAuditLogs } from '@/lib/admin/queries/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { Input } from '@/components/ui/input';

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; targetType?: string; page?: string }>;
}) {
  await requireAdmin('audit:read');
  const params = await searchParams;
  const page = Number(params.page) || 1;

  const { logs, total, pageSize } = await listAuditLogs({
    action: params.action,
    targetType: params.targetType,
    page,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <AdminPageHeader
        title="Audit Logs"
        description="Read-only, immutable record of privileged admin actions."
      />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input
          theme="app"
          name="action"
          defaultValue={params.action}
          placeholder="Filter by action (e.g. user.ban)"
          className="w-72"
        />
        <Input
          theme="app"
          name="targetType"
          defaultValue={params.targetType}
          placeholder="Target type (e.g. User)"
          className="w-56"
        />
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
              <th className="px-4 py-2.5 font-medium">Action</th>
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-4 py-2.5 font-medium">Admin</th>
              <th className="px-4 py-2.5 font-medium">Result</th>
              <th className="px-4 py-2.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-app-border-subtle">
                <td className="px-4 py-2.5 font-mono text-xs text-app-text">
                  {log.action}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {log.targetType}
                  {log.targetId ? ` #${log.targetId.slice(0, 8)}` : ''}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {log.adminEmail ?? log.adminId ?? 'system'}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={log.result === 'SUCCESS' ? 'success' : 'danger'}>
                    {log.result}
                  </StatusPill>
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {formatDateTime(log.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 ? (
          <p className="p-8 text-center text-sm text-app-text-muted">
            No audit entries match these filters.
          </p>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <p className="mt-4 text-sm text-app-text-secondary">
          Page {page} of {totalPages}
        </p>
      ) : null}
    </div>
  );
}

import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { BackupActions } from '@/components/admin/backups/backup-actions';
import { getBackupHealth, listBackupRuns } from '@/lib/backups';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';

function formatBytes(bytes: number | null) {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function Page() {
  const auth = await requireAdmin('backups:read');
  if (!auth.ok) return null;

  const [runs, health] = await Promise.all([listBackupRuns(40), getBackupHealth()]);
  const failures = runs.filter((run) => run.status === 'FAILED');
  const canWrite = hasPermission(auth.admin.adminRole, 'backups:write');

  return (
    <div>
      <AdminPageHeader
        title="Backups"
        description="Scheduled database backups to object storage and periodic restore drills. Alerts fire on failure or staleness (see docs/runbooks/backup-restore.md)."
        actions={canWrite ? <BackupActions /> : undefined}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard
          label="Status"
          value={health.issues.length ? 'Attention' : health.warnings.length ? 'Drill overdue' : 'Healthy'}
        />
        <KpiCard label="Last good backup" value={health.lastBackupAt ? formatDateTime(health.lastBackupAt) : 'Never'} />
        <KpiCard label="Last restore drill" value={health.lastDrillAt ? formatDateTime(health.lastDrillAt) : 'Never'} />
        <KpiCard label="Failures (last 40 runs)" value={String(failures.length)} />
      </div>

      {[...health.issues, ...health.warnings].length ? (
        <ul className="mb-6 space-y-1 rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          {[...health.issues, ...health.warnings].map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {runs.length ? (
        <div className="overflow-hidden rounded-xl border border-app-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Finished</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Location / error</th>
                <th className="px-3 py-2 font-medium">Pruned</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-app-border-subtle align-top">
                  <td className="px-3 py-2 text-app-text-secondary">{formatDateTime(run.finishedAt)}</td>
                  <td className="px-3 py-2">{run.kind === 'BACKUP' ? 'Backup' : 'Restore drill'}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={run.status === 'SUCCESS' ? 'success' : 'danger'}>{run.status}</StatusPill>
                    {run.encrypted ? <StatusPill className="ml-1">encrypted</StatusPill> : null}
                  </td>
                  <td className="px-3 py-2 text-app-text-secondary">{formatBytes(run.sizeBytes)}</td>
                  <td className="max-w-md break-all px-3 py-2 text-xs text-app-text-secondary">
                    {run.error ?? run.location ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-app-text-secondary">{run.retentionDeleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AdminEmptyState message="No backup runs have been reported yet. Configure the Backup workflow (see the runbook)." />
      )}
    </div>
  );
}

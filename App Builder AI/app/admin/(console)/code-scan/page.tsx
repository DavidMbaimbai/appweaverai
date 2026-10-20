import { RescanButton } from '@/components/admin/code-scan/rescan-button';
import { SeverityDonut } from '@/components/app/code-scan/quality-charts';
import { getAdminQualityExtras } from '@/lib/code-scan/dashboard';
import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminOverview, listLatestScansPerProject } from '@/lib/code-scan/service';

export default async function Page() {
  const auth = await requireAdmin('codescan:read');
  if (!auth.ok) return null;

  const [overview, scans] = await Promise.all([getAdminOverview(), listLatestScansPerProject(100)]);
  const extras = await getAdminQualityExtras(scans.map((s) => ({ ...s, projectId: s.project.id })));
  const canWrite = hasPermission(auth.admin.adminRole, 'codescan:write');
  const rows = [...scans].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div>
      <AdminPageHeader
        title="Code scan"
        description="Latest security and quality scan per customer project. HIGH/CRITICAL findings block publish until fixed or acknowledged by the owner with a reason."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard label="Scans (30 days)" value={String(overview.runs)} />
        <KpiCard label="Projects scanned" value={String(overview.projectsScanned)} />
        <KpiCard label="Open HIGH/CRITICAL" value={String(overview.openBlocking)} />
        <KpiCard label="Acknowledged HIGH/CRITICAL" value={String(overview.acknowledgedBlocking)} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard label="Average quality score" value={extras.averageScore === null ? '—' : String(extras.averageScore)} />
        <KpiCard label="Scheduled re-scans on" value={`${extras.schedulesOn} / ${extras.schedulesTotal}`} />
        <KpiCard label="Approvals pending" value={String(extras.pendingApprovals)} />
        <KpiCard label="Regression failed / not run" value={`${extras.regressionFailed} / ${extras.regressionNotRun}`} />
      </div>

      <div className="mb-6 rounded-xl border border-app-border-subtle p-4">
        <h2 className="mb-2 text-sm font-medium">Findings by severity (latest scan per project)</h2>
        <SeverityDonut counts={extras.severityTotals} />
      </div>

      {overview.topRules.length ? (
        <div className="mb-6 rounded-xl border border-app-border-subtle p-4">
          <h2 className="mb-2 text-sm font-medium">Most common rules</h2>
          <ul className="grid gap-1 text-sm text-app-text-secondary sm:grid-cols-2">
            {overview.topRules.map((r) => (
              <li key={r.rule} className="flex justify-between gap-3">
                <code className="truncate">{r.rule}</code>
                <span>{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length ? (
        <div className="overflow-hidden rounded-xl border border-app-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Scanned</th>
                <th className="px-3 py-2 font-medium">Critical</th>
                <th className="px-3 py-2 font-medium">High</th>
                <th className="px-3 py-2 font-medium">Medium</th>
                <th className="px-3 py-2 font-medium">Dependencies</th>
                {canWrite ? <th className="px-3 py-2 font-medium" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <tr key={run.id} className="border-t border-app-border-subtle align-top">
                  <td className="px-3 py-2">
                    <div>{run.project.name}</div>
                    <div className="text-xs text-app-text-muted">
                      {run.project.workspace.slug}/{run.project.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-app-text-secondary">{formatDateTime(run.createdAt)}</td>
                  <td className="px-3 py-2">{run.criticalCount}</td>
                  <td className="px-3 py-2">{run.highCount}</td>
                  <td className="px-3 py-2">{run.mediumCount}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={run.depStatus === 'OK' ? 'success' : 'danger'}>
                      {run.depStatus === 'OK' ? 'Checked' : run.depStatus.toLowerCase()}
                    </StatusPill>
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2">
                      <RescanButton projectId={run.project.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AdminEmptyState message="No projects have been scanned yet." />
      )}
    </div>
  );
}

import { ReportControls, SeedButton, SubmissionControls } from '@/components/admin/marketplace/moderation-controls';
import { AdminEmptyState, AdminPageHeader, KpiCard, StatusPill, formatDateTime, formatNumber } from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { PAYOUTS_BLOCKED_MESSAGE, platformFeeBps, salesState } from '@/lib/marketplace/config';
import { listModerationQueue } from '@/lib/marketplace/moderate';
import { TYPE_LABELS } from '@/lib/marketplace/types';

type Finding = { rule?: string; title?: string; message?: string; severity?: string; path?: string; file?: string };

export default async function Page() {
  const auth = await requireAdmin('marketplace:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'marketplace:write');
  const queue = await listModerationQueue();
  const sales = salesState();
  const fee = platformFeeBps();

  return (
    <div>
      <AdminPageHeader
        title="Marketplace"
        description="Moderation queue for creator submissions and abuse reports. Nothing is published without passing the safety scan and an explicit approval."
        actions={canWrite ? <SeedButton /> : undefined}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard label="Pending review" value={formatNumber(queue.pending.length)} />
        <KpiCard label="Open reports" value={formatNumber(queue.reports.length)} />
        <KpiCard label="Taken down" value={formatNumber(queue.removed)} />
        <KpiCard
          label="Paid sales"
          value={sales.enabled ? 'Enabled' : 'Disabled'}
          hint={sales.enabled ? `Fee ${(fee ?? 0) / 100}% (configured)` : sales.reason}
        />
      </div>
      <p className="mb-6 text-xs text-app-text-muted">{PAYOUTS_BLOCKED_MESSAGE}</p>

      <h2 className="mb-2 text-sm font-semibold text-app-text">Submissions</h2>
      {queue.pending.length === 0 ? (
        <AdminEmptyState message="No submissions are waiting for review." />
      ) : (
        <ul className="mb-8 space-y-3">
          {queue.pending.map((v) => {
            const findings = (Array.isArray(v.scanFindings) ? v.scanFindings : []) as Finding[];
            const blocked = v.scanVerdict === 'blocked';
            return (
              <li key={v.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-app-text">{v.asset.title}</strong>
                  <span className="text-xs text-app-text-muted">
                    {TYPE_LABELS[v.asset.type]} · v{v.version} · by {v.asset.creator?.displayName ?? 'unknown'} · {v.fileCount} files · {v.sizeBytes} bytes · {v.asset.license}
                  </span>
                  <StatusPill tone={blocked ? 'danger' : v.scanVerdict === 'flagged' ? 'warning' : 'success'}>scan: {v.scanVerdict}</StatusPill>
                  <span className="text-xs text-app-text-muted">{formatDateTime(v.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm text-app-text-secondary">{v.asset.summary}</p>
                {findings.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-xs text-app-text-secondary">
                    {findings.slice(0, 10).map((f, i) => (
                      <li key={i}>
                        {f.severity ? `[${f.severity}] ` : ''}
                        {f.title ?? f.rule ?? f.message ?? 'finding'}
                        {f.path ?? f.file ? ` (${f.path ?? f.file})` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canWrite ? (
                  <div className="mt-3">
                    <SubmissionControls versionId={v.id} blocked={blocked} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-2 text-sm font-semibold text-app-text">Reports</h2>
      {queue.reports.length === 0 ? (
        <AdminEmptyState message="No open reports." />
      ) : (
        <ul className="space-y-3">
          {queue.reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-app-text">{r.asset.title}</strong>
                <StatusPill tone="warning">{r.reason}</StatusPill>
                <span className="text-xs text-app-text-muted">{formatDateTime(r.createdAt)}</span>
              </div>
              {r.details ? <p className="mt-2 whitespace-pre-line text-app-text-secondary">{r.details}</p> : null}
              {canWrite ? (
                <div className="mt-3">
                  <ReportControls reportId={r.id} assetId={r.asset.id} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

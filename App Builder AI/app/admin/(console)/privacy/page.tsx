import { PrivacyConsole } from '@/components/admin/privacy/privacy-console';
import { AdminPageHeader, KpiCard } from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { listRequests, requestsSummary } from '@/lib/privacy/requests';
import { listRetentionPolicies } from '@/lib/privacy/retention';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const auth = await requireAdmin('privacy:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'privacy:write');

  const [requests, summary, policies] = await Promise.all([listRequests(), requestsSummary(), listRetentionPolicies()]);

  return (
    <div>
      <AdminPageHeader
        title="Privacy"
        description="Data-subject requests (30-day SLA from verified receipt), consents and retention policies. Data inventory: docs/privacy/data-map.md."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Open requests" value={String(summary.open)} />
        <KpiCard label="Due within 5 days" value={String(summary.dueSoon)} />
        <KpiCard label="Overdue" value={String(summary.overdue)} />
      </div>
      <PrivacyConsole
        canWrite={canWrite}
        requests={requests.map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          requesterName: r.requesterName,
          email: r.email,
          phone: r.phone,
          details: r.details,
          receivedAt: r.receivedAt.toISOString(),
          dueAt: r.dueAt?.toISOString() ?? null,
          outcome: r.outcome,
          outcomeNote: r.outcomeNote,
          sla: r.sla,
        }))}
        policies={policies.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          retentionDays: p.retentionDays,
          enabled: p.enabled,
          dryRun: p.dryRun,
          lastRunAt: p.lastRunAt?.toISOString() ?? null,
          lastRunCount: p.lastRunCount,
        }))}
      />
    </div>
  );
}

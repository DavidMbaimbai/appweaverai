import { ActivityActions, KillSwitchControl, PlatformAgentControl } from '@/components/admin/command-centre/controls';
import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
  formatNumber,
  type PillTone,
} from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { getCommandCentreMetrics, type Metric } from '@/lib/agents/command-centre';
import { getKillSwitches } from '@/lib/agents/pause';
import { providerHealth } from '@/lib/agents/providers';
import { listAgentSettings } from '@/lib/agents/settings';
import { ACTIVITY_STATUSES, AGENT_LABELS, AGENT_ROLES, isAgentRole } from '@/lib/agents/types';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ status?: string; agent?: string; scope?: string }> };

const NA = 'not available';
const num = (v: Metric) => (v === null ? NA : formatNumber(v));
const money = (v: Metric) => (v === null ? NA : formatCurrencyCents(v));
const STATUS_TONE: Record<string, PillTone> = {
  DONE: 'success', FAILED: 'danger', BLOCKED: 'warning', AWAITING_APPROVAL: 'info', RUNNING: 'info', PLANNED: 'neutral',
};

export default async function CommandCentrePage({ searchParams }: Props) {
  const auth = await requireAdmin('commandcentre:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'commandcentre:write');
  const filters = await searchParams;

  const where = {
    ...(filters.status && (ACTIVITY_STATUSES as readonly string[]).includes(filters.status) ? { status: filters.status as (typeof ACTIVITY_STATUSES)[number] } : {}),
    ...(isAgentRole(filters.agent) ? { agent: filters.agent } : {}),
    ...(filters.scope === 'PLATFORM' ? { scopeType: 'PLATFORM' as const } : filters.scope === 'PROJECT' ? { scopeType: 'PROJECT' as const } : {}),
  };
  const [metrics, switches, settings, activities] = await Promise.all([
    getCommandCentreMetrics(),
    getKillSwitches().catch(() => null),
    listAgentSettings({ type: 'PLATFORM' }).catch(() => null),
    prisma.agentActivity.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }).catch(() => null),
  ]);
  const providers = providerHealth();
  const m = metrics;

  return (
    <>
      <AdminPageHeader title="Command Centre" description="Today's automation activity (UTC), integration health and agent controls. Metrics that can't be read show “not available”, never zero." />
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text">Kill switch</h2>
          {switches === null ? (
            <AdminEmptyState message="Kill switch status is not available (run the latest database migration)." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {switches.map((s) => (
                <div key={s.scope} className="flex items-center justify-between rounded-xl border border-app-border-subtle bg-app-surface p-4">
                  <div>
                    <p className="text-sm font-medium text-app-text">{s.scope === 'GLOBAL' ? 'Global (all agents and automations)' : 'Platform automations (social, ads, replies, outreach)'}</p>
                    <StatusPill tone={s.paused ? 'danger' : 'success'}>{s.paused ? 'Paused' : 'Running'}</StatusPill>
                    {s.reason ? <span className="ml-2 text-xs text-app-text-muted">{s.reason}</span> : null}
                  </div>
                  <KillSwitchControl scope={s.scope} paused={s.paused} canWrite={canWrite} />
                </div>
              ))}
            </div>
          )}
        </section>

        <Group title="Content">
          <KpiCard label="Generated today" value={num(m.content.generated)} />
          <KpiCard label="Scheduled (queued)" value={num(m.content.scheduled)} />
          <KpiCard label="Published today" value={num(m.content.published)} />
          <KpiCard label="Failed today" value={num(m.content.failed)} />
          <KpiCard label="Videos rendering" value={num(m.video.rendering)} />
          <KpiCard label="Videos completed today" value={num(m.video.completed)} />
        </Group>
        <Group title="Conversations">
          <KpiCard label="Social conversations" value={num(m.conversations.conversations)} />
          <KpiCard label="Escalations" value={num(m.conversations.escalations)} />
          <KpiCard label="Support tickets" value={num(m.conversations.supportTickets)} />
        </Group>
        <Group title="Growth">
          <KpiCard label="Leads" value={num(m.growth.leads)} />
          <KpiCard label="Investor prospects" value={num(m.growth.investorProspects)} />
          <KpiCard label="Outreach sent" value={num(m.growth.outreachSent)} />
          <KpiCard label="Replies" value={num(m.growth.replies)} />
          <KpiCard label="Meetings booked" value={num(m.growth.meetingsBooked)} />
        </Group>
        <Group title="Spend and quota">
          <KpiCard label="Customer ads spend (recorded, all time)" value={money(m.spend.customerAdsCents)} />
          <KpiCard label="House ads spend (recorded, all time)" value={money(m.spend.houseAdsCents)} />
          <KpiCard label="AI calls today" value={num(m.quota.aiCallsToday)} hint={m.quota.aiCostTodayCents === null ? undefined : `est. ${formatCurrencyCents(m.quota.aiCostTodayCents)}`} />
          <KpiCard label="Video jobs today" value={num(m.quota.videoJobsToday)} />
          <KpiCard label="Agent actions today" value={num(m.quota.agentActionsToday)} />
        </Group>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text">Provider health</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-app-text">{p.label}</span>
                  <StatusPill tone={p.configured ? 'success' : 'danger'}>{p.configured ? 'Configured' : 'Missing config'}</StatusPill>
                </div>
                {p.missing.length > 0 ? <p className="mt-2 break-words font-mono text-xs text-app-text-secondary">Missing: {p.missing.join(', ')}</p> : null}
                {p.note ? <p className="mt-1 text-xs text-app-text-muted">{p.note}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text">Platform agents</h2>
          {settings === null ? (
            <AdminEmptyState message="Agent settings are not available (run the latest database migration)." />
          ) : (
            <ul className="space-y-2">
              {settings.map((s) => (
                <li key={s.agent} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border-subtle bg-app-surface p-3">
                  <div className="text-sm text-app-text">
                    {AGENT_LABELS[s.agent].label}
                    <span className="ml-2 inline-flex gap-1.5">
                      <StatusPill tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'Enabled' : 'Disabled'}</StatusPill>
                      <StatusPill>{s.mode}</StatusPill>
                      {s.paused ? <StatusPill tone="danger">Paused</StatusPill> : null}
                    </span>
                  </div>
                  <PlatformAgentControl agent={s.agent} paused={s.paused} enabled={s.enabled} canWrite={canWrite} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text">Agent activity</h2>
          <form className="flex flex-wrap gap-2 text-sm" method="get">
            <select name="status" defaultValue={filters.status ?? ''} className="rounded-lg border border-app-border-subtle bg-app-surface px-2 py-1.5 text-app-text">
              <option value="">All statuses</option>
              {ACTIVITY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select name="agent" defaultValue={filters.agent ?? ''} className="rounded-lg border border-app-border-subtle bg-app-surface px-2 py-1.5 text-app-text">
              <option value="">All agents</option>
              {AGENT_ROLES.map((a) => <option key={a} value={a}>{AGENT_LABELS[a].label}</option>)}
            </select>
            <select name="scope" defaultValue={filters.scope ?? ''} className="rounded-lg border border-app-border-subtle bg-app-surface px-2 py-1.5 text-app-text">
              <option value="">All scopes</option>
              <option value="PLATFORM">Platform</option>
              <option value="PROJECT">Projects</option>
            </select>
            <button type="submit" className="rounded-lg border border-app-border-subtle px-3 py-1.5 text-app-text hover:bg-app-surface-hover">Filter</button>
          </form>
          {activities === null ? (
            <AdminEmptyState message="Activity log is not available (run the latest database migration)." />
          ) : activities.length === 0 ? (
            <AdminEmptyState message="No agent activity matches." />
          ) : (
            <ul className="space-y-2">
              {activities.map((a) => (
                <li key={a.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</StatusPill>
                    <span className="font-medium text-app-text">{a.action}</span>
                    <span className="text-app-text-muted">{AGENT_LABELS[a.agent].label} · {a.scopeType === 'PLATFORM' ? 'Platform' : `Project ${a.scopeId}`} · risk {a.risk} · {formatDateTime(a.createdAt)}</span>
                  </div>
                  <details className="mt-2 text-xs text-app-text-secondary">
                    <summary className="cursor-pointer">Inspect</summary>
                    <dl className="mt-2 space-y-1 break-words">
                      <Row k="Tool" v={a.tool} />
                      <Row k="Input" v={a.inputSummary} />
                      <Row k="Result" v={a.resultSummary} />
                      <Row k="Decision" v={a.decisionReason} />
                      <Row k="Error" v={a.error} />
                      <Row k="Cost" v={formatCurrencyCents(a.costCents)} />
                      <Row k="Credits charged" v={a.creditsCharged === null ? NA : String(a.creditsCharged)} />
                      <Row k="Sources" v={a.sources ? JSON.stringify(a.sources) : null} />
                      <Row k="Retry of" v={a.retryOf} />
                      <Row k="Decided by" v={a.decidedBy} />
                    </dl>
                  </details>
                  <div className="mt-2"><ActivityActions id={a.id} status={a.status} canWrite={canWrite} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-app-text">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div>
      <dt className="inline font-medium text-app-text">{k}: </dt>
      <dd className="inline">{v}</dd>
    </div>
  );
}

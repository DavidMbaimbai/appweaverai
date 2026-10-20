import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ObservatoryActions } from '@/components/admin/observatory/observatory-actions';
import { ViewportPreview } from '@/components/admin/observatory/viewport-preview';
import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getObservatoryDetail, recordProjectAccess } from '@/lib/observatory/queries';
import { averageResponseHours } from '@/lib/observatory/stats';

export const dynamic = 'force-dynamic';

const section = 'rounded-xl border border-app-border-subtle bg-app-surface p-4';

type Evidence = { type: string; ref: string; detail: string };

export default async function ObservatoryProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const auth = await requireAdmin('observatory:read');
  if (!auth.ok) return null;
  const { projectId } = await params;

  const detail = await getObservatoryDetail(projectId);
  if (!detail) notFound();

  const requestHeaders = await headers();
  await recordProjectAccess({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    projectId,
    ipAddress: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  const canWrite = hasPermission(auth.admin.adminRole, 'observatory:write');
  const { project, current, inventory } = detail;
  const productionUrl =
    current && current.status === 'LIVE' && current.visibility === 'PUBLIC'
      ? current.customDomain
        ? `https://${current.customDomain}`
        : current.domain.startsWith('/')
          ? current.domain
          : `https://${current.domain}`
      : null;
  const artifactSlug = project.artifacts[0]?.slug;
  const developmentUrl = artifactSlug ? `/api/projects/${project.id}/preview/${artifactSlug}` : null;

  const reviews = detail.reviews;
  const rated = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  const byState = reviews.reduce<Record<string, number>>((acc, r) => {
    acc[r.responseState] = (acc[r.responseState] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={project.name}
        description={`${project.workspace.name} · ${project.id}`}
        actions={
          <Link href={`/admin/projects/${project.id}`} className="text-sm text-app-text-secondary hover:underline">
            Admin project controls →
          </Link>
        }
      />

      <ObservatoryActions
        projectId={project.id}
        canWrite={canWrite}
        verifiableIssueIds={detail.issues.filter((i) => i.status === 'APPROVED' || i.status === 'DEPLOYED').map((i) => i.id)}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Owner" value={project.createdBy?.name || project.createdBy?.email || 'Unknown'} hint={project.createdBy?.email ?? undefined} />
        <KpiCard label="Deployment" value={current ? `${current.status} v${current.version}` : 'Not deployed'} hint={current?.publishedAt ? `Published ${formatDateTime(current.publishedAt)}` : undefined} />
        <KpiCard label="Live URL" value={current ? (current.customDomain ?? current.domain) : '—'} hint={current ? current.visibility : undefined} />
        <KpiCard label="Created" value={formatDateTime(project.createdAt)} hint={`Updated ${formatDateTime(project.updatedAt)}`} />
      </div>

      <ViewportPreview productionUrl={productionUrl} developmentUrl={developmentUrl} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className={section}>
          <h2 className="mb-2 text-sm font-medium text-app-text">Health checks</h2>
          {detail.health.length ? (
            <ul className="space-y-1 text-xs text-app-text-secondary">
              {detail.health.map((h) => (
                <li key={h.id}>
                  <StatusPill tone={h.ok ? 'success' : 'danger'}>{h.ok ? 'OK' : 'FAIL'}</StatusPill>{' '}
                  {formatDateTime(h.checkedAt)} — {h.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-app-text-muted">No health checks recorded.</p>
          )}
        </div>
        <div className={section}>
          <h2 className="mb-2 text-sm font-medium text-app-text">Smoke checks</h2>
          {detail.smoke.length ? (
            <ul className="space-y-1 text-xs text-app-text-secondary">
              {detail.smoke.map((s) => (
                <li key={s.id}>
                  <StatusPill tone={s.outcome === 'PASS' ? 'success' : s.outcome === 'CONFIRMED_FAILURE' ? 'danger' : 'warning'}>
                    {s.outcome.replace('_', ' ')}
                  </StatusPill>{' '}
                  {formatDateTime(s.checkedAt)} · v{s.version ?? '?'} · HTTP {s.statusCode ?? 'n/a'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-app-text-muted">No smoke checks yet.</p>
          )}
        </div>
      </div>

      <div className={section}>
        <h2 className="mb-2 text-sm font-medium text-app-text">Recent errors</h2>
        {detail.errors.length ? (
          <ul className="space-y-1 text-xs text-app-text-secondary">
            {detail.errors.map((e, i) => (
              <li key={i}>
                <span className="text-app-text-muted">{formatDateTime(e.at)}</span> · {e.source} · {e.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-app-text-muted">No recorded failures.</p>
        )}
      </div>

      <div className={section}>
        <h2 className="mb-2 text-sm font-medium text-app-text">
          App inventory · {inventory.framework} · {inventory.totalFiles} files
        </h2>
        <div className="grid gap-4 text-xs text-app-text-secondary md:grid-cols-3">
          <div>
            <p className="mb-1 font-medium text-app-text-muted">Pages / routes</p>
            {inventory.pages.length ? inventory.pages.slice(0, 40).map((p) => <p key={p} className="font-mono">{p}</p>) : <p>None detected</p>}
          </div>
          <div>
            <p className="mb-1 font-medium text-app-text-muted">API endpoints</p>
            {inventory.apiEndpoints.length ? inventory.apiEndpoints.slice(0, 40).map((p) => <p key={p} className="font-mono">{p}</p>) : <p>None detected</p>}
          </div>
          <div>
            <p className="mb-1 font-medium text-app-text-muted">Modules</p>
            {inventory.modules.length ? inventory.modules.map((m) => <p key={m.name}>{m.name} ({m.files})</p>) : <p>None detected</p>}
          </div>
        </div>
      </div>

      <div className={section}>
        <h2 className="mb-2 text-sm font-medium text-app-text">Feature ledger</h2>
        {detail.features.length ? (
          <ul className="space-y-3">
            {detail.features.map((f) => (
              <li key={f.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-app-text">{f.name}</span>
                  <StatusPill tone={f.status === 'TESTED' ? 'success' : f.status === 'KNOWN_ISSUE' ? 'danger' : f.status === 'PLANNED' ? 'neutral' : 'info'}>
                    {f.status}
                  </StatusPill>
                  {f.version ? <span className="text-xs text-app-text-muted">v{f.version}</span> : null}
                </div>
                {f.summary ? <p className="text-xs text-app-text-secondary">{f.summary}</p> : null}
                <ul className="mt-1 text-xs text-app-text-muted">
                  {(Array.isArray(f.evidence) ? (f.evidence as Evidence[]) : []).map((e, i) => (
                    <li key={i}>
                      [{e.type}] <span className="font-mono">{e.ref}</span> — {e.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState message="No ledger yet. Use “Refresh feature ledger”." />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={section}>
          <h2 className="mb-2 text-sm font-medium text-app-text">Recent agent changes</h2>
          <ul className="space-y-1 text-xs text-app-text-secondary">
            {detail.conversations.map((c) => (
              <li key={c.id}>{formatDateTime(c.updatedAt)} · {c.title ?? 'Conversation'} ({c._count.messages} messages)</li>
            ))}
            {detail.checkpoints.map((c) => (
              <li key={c.id}>{formatDateTime(c.createdAt)} · checkpoint “{c.label}”{c.isAutomatic ? ' (auto)' : ''}</li>
            ))}
            {!detail.conversations.length && !detail.checkpoints.length ? <li className="text-app-text-muted">No agent activity.</li> : null}
          </ul>
        </div>
        <div className={section}>
          <h2 className="mb-2 text-sm font-medium text-app-text">Reviews &amp; support (aggregate only)</h2>
          <ul className="space-y-1 text-xs text-app-text-secondary">
            <li>{reviews.length} reviews{rated !== null ? ` · average ${rated.toFixed(1)}/5` : ''}</li>
            <li>Open support tickets: {detail.openTickets}</li>
            <li>
              Avg response time: {averageResponseHours(reviews) === null ? 'not measured' : `${averageResponseHours(reviews)} h`}
            </li>
            <li>{Object.entries(byState).map(([k, v]) => `${k.toLowerCase().replace(/_/g, ' ')}: ${v}`).join(' · ') || 'No drafts'}</li>
          </ul>
          <h3 className="mb-1 mt-3 text-xs font-medium text-app-text-muted">Issues</h3>
          <ul className="space-y-1 text-xs text-app-text-secondary">
            {detail.issues.length ? (
              detail.issues.map((i) => (
                <li key={i.id}>
                  <StatusPill tone={i.status === 'VERIFIED' ? 'success' : 'neutral'}>{i.status}</StatusPill> {i.title}
                </li>
              ))
            ) : (
              <li className="text-app-text-muted">No issues.</li>
            )}
          </ul>
        </div>
      </div>

      <div className={section}>
        <h2 className="mb-2 text-sm font-medium text-app-text">Admin access log</h2>
        <ul className="space-y-1 text-xs text-app-text-secondary">
          {detail.accessLog.map((a) => (
            <li key={a.id}>
              {formatDateTime(a.createdAt)} · {a.adminEmail ?? a.adminId} · {a.action}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

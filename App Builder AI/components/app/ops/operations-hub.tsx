'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  opsPromoteAction,
  opsPushGithubAction,
  opsRestoreCheckpointAction,
  opsRollbackAction,
  opsRunHealthCheckAction,
} from '@/lib/ops/actions';
import {
  bucketByDay,
  formatDuration,
  inRange,
  kpis,
  statusDistribution,
  successRateByEnvironment,
  weeklyTrend,
} from '@/lib/ops/aggregate';
import type { OperationsData, OpsDeploymentRow } from '@/lib/ops/service';
import type { PublishVisibility } from '@/lib/publish/visibility';

import { DeploymentsPerDayChart, RateBar, StatusDonut, WeeklyTrendChart } from './ops-charts';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'environments', label: 'Environments' },
  { id: 'versions', label: 'Versions & source' },
  { id: 'data', label: 'Data' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const fmt = (iso: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '—');

const STATUS_STYLE: Record<string, string> = {
  LIVE: 'bg-emerald-600/20 text-emerald-300',
  SUPERSEDED: 'bg-app-surface text-app-text-muted',
  FAILED: 'bg-red-600/20 text-red-300',
  NOT_DEPLOYED: 'bg-app-surface text-app-text-muted',
  NOT_AVAILABLE: 'bg-app-surface text-app-text-muted',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-amber-600/20 text-amber-300'}`}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-app-border-subtle bg-app-surface/40 p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-app-border-subtle p-4 text-sm text-app-text-secondary">{children}</p>;
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-app-border-subtle p-3 text-sm text-app-text-muted">
      <span className="mr-2 rounded-full bg-app-surface px-2 py-0.5 text-xs font-medium">Not available</span>
      {children}
    </p>
  );
}

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  isOwner: boolean;
  githubAccount: string | null;
  data: OperationsData;
  generatedAt: string;
};

export function OperationsHub({ projectId, projectName, builderHref, isOwner, githubAccount, data, generatedAt }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('dashboard');
  const [range, setRange] = useState<7 | 30>(7);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [visibility, setVisibility] = useState<PublishVisibility>('public');

  const now = useMemo(() => new Date(generatedAt), [generatedAt]);
  const points = data.deployments.chartPoints;
  const ranged = useMemo(() => inRange(points, range, now), [points, range, now]);
  const stats = kpis(ranged);

  function run(
    task: () => Promise<{ error?: string; [key: string]: unknown }>,
    okText: string | ((result: Record<string, unknown>) => string),
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      setMessage(null);
      try {
        const result = await task();
        if (result.error) setMessage({ kind: 'error', text: result.error });
        else {
          setMessage({ kind: 'ok', text: typeof okText === 'function' ? okText(result) : okText });
          router.refresh();
        }
      } catch {
        setMessage({ kind: 'error', text: 'Something went wrong. Please try again.' });
      }
    });
  }

  const ownerOnly = (node: React.ReactNode) =>
    isOwner ? node : <span className="text-xs text-app-text-muted">Owner only</span>;

  const btn =
    'rounded-full border border-app-border-subtle px-3 py-1 text-xs font-medium hover:bg-app-surface-hover disabled:opacity-50';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href={builderHref} className="text-sm text-app-text-secondary hover:underline">
        ← Back to {projectName}
      </Link>
      <h1 className="mt-3 text-xl font-semibold">Operations</h1>
      <p className="text-sm text-app-text-secondary">
        Deployments, environments, versions and data for {projectName}.
        {isOwner ? '' : ' You have read-only access; only the project owner can make changes.'}
      </p>

      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-4 rounded-lg border p-3 text-sm ${
            message.kind === 'error'
              ? 'border-red-900/60 bg-red-950/30 text-red-300'
              : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
          }`}>
          {message.text}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <div role="tablist" aria-label="Operations sections" aria-orientation="vertical" className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`ops-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`ops-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${
                tab === t.id ? 'bg-app-surface font-medium text-app-text' : 'text-app-text-secondary hover:bg-app-surface-hover'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div id={`ops-panel-${tab}`} role="tabpanel" aria-labelledby={`ops-tab-${tab}`} aria-busy={pending} className="min-w-0 flex-1 space-y-4">
          {tab === 'dashboard' ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-app-text-muted">Days are UTC. Preview builds are not recorded as deployments.</p>
                <div role="group" aria-label="Date range" className="flex rounded-full border border-app-border-subtle p-0.5 text-xs">
                  {([7, 30] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={range === d}
                      onClick={() => setRange(d)}
                      className={`rounded-full px-3 py-1 ${range === d ? 'bg-app-accent text-white' : 'text-app-text-secondary'}`}>
                      {d} days
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                {[
                  ['Total deployments', stats.total],
                  ['Successful', stats.successful],
                  ['Failed', stats.failed],
                  ['Running now', stats.running],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-app-border-subtle bg-app-surface/40 p-4">
                    <p className="text-xs text-app-text-muted">{label}</p>
                    <p className="mt-1 text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              {stats.total === 0 ? (
                <Empty>No deployments in the last {range} days. Publish your project to see activity here.</Empty>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Deployments per day" className="lg:col-span-2">
                  <DeploymentsPerDayChart buckets={bucketByDay(ranged, range, now)} />
                </Card>
                <Card title="Status distribution">
                  <StatusDonut counts={statusDistribution(ranged)} />
                </Card>
                <Card title="Weekly trend (8 weeks)" className="lg:col-span-2">
                  <WeeklyTrendChart weeks={weeklyTrend(points, 8, now)} />
                </Card>
                <Card title="Success rate by environment">
                  <div className="space-y-4">
                    {(['PRODUCTION', 'STAGING'] as const).map((env) => {
                      const row = successRateByEnvironment(ranged)[env];
                      return <RateBar key={env} label={env === 'PRODUCTION' ? 'Production' : 'Staging'} rate={row.rate} total={row.total} />;
                    })}
                    <Unavailable>Preview: not tracked as deployments.</Unavailable>
                  </div>
                </Card>
              </div>
            </>
          ) : null}

          {tab === 'deployments' ? (
            <Card title="Deployment history">
              {isOwner && data.environments[1].version ? (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-app-border-subtle p-3 text-sm">
                  <span>Promote staging v{data.environments[1].version} to production:</span>
                  <label className="sr-only" htmlFor="ops-visibility">Visibility</label>
                  <select
                    id="ops-visibility"
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as PublishVisibility)}
                    className="rounded border border-app-border-subtle bg-app-bg px-2 py-1 text-xs">
                    <option value="public">Public</option>
                    <option value="workspace">Workspace only</option>
                    <option value="private">Private</option>
                  </select>
                  <button
                    type="button"
                    disabled={pending}
                    className={btn}
                    onClick={() =>
                      run(
                        () => opsPromoteAction(projectId, visibility),
                        'Staging promoted to production.',
                        'Promote the live staging version to production?',
                      )
                    }>
                    Promote
                  </button>
                </div>
              ) : null}
              {data.deployments.history.length === 0 ? (
                <Empty>No deployments yet. Publish to staging or production from the editor.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <caption className="sr-only">Deployment history, newest first</caption>
                    <thead className="text-xs text-app-text-muted">
                      <tr>
                        <th scope="col" className="py-2 pr-3">Version</th>
                        <th scope="col" className="pr-3">Environment</th>
                        <th scope="col" className="pr-3">Status</th>
                        <th scope="col" className="pr-3">Duration</th>
                        <th scope="col" className="pr-3">Created</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.deployments.history.map((d) => (
                        <DeploymentRow
                          key={d.id}
                          d={d}
                          isOwner={isOwner}
                          pending={pending}
                          onRollback={() =>
                            run(
                              () => opsRollbackAction(projectId, d.id),
                              (r) => `Rolled back to v${d.version} as new version v${String(r.version)}.`,
                              `Roll back to v${d.version}? This creates a new deployment from that version's files.`,
                            )
                          }
                          btn={btn}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-app-text-muted">Showing the latest {data.deployments.history.length} deployments within your plan&apos;s retention.</p>
            </Card>
          ) : null}

          {tab === 'environments' ? (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                {data.environments.map((env) => (
                  <Card key={env.key} title={env.label}>
                    <StatusBadge status={env.status} />
                    {env.note ? <p className="mt-2 text-xs text-app-text-muted">{env.note}</p> : null}
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-2"><dt className="text-app-text-muted">Version</dt><dd>{env.version ? `v${env.version}` : '—'}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-app-text-muted">Published</dt><dd>{fmt(env.publishedAt)}</dd></div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-app-text-muted">Environment variables</dt>
                        <dd>{env.envVarCount ?? '—'} <span className="text-xs text-app-text-muted">(names only)</span></dd>
                      </div>
                    </dl>
                    {env.url ? (
                      <a href={env.url} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm text-app-accent hover:underline">
                        {env.url}
                      </a>
                    ) : null}
                  </Card>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Health check">
                  {data.health.last ? (
                    <div className="text-sm">
                      <p>
                        <span className={data.health.last.ok ? 'text-emerald-300' : 'text-red-300'}>
                          {data.health.last.ok ? 'Healthy' : 'Unhealthy'}
                        </span>{' '}
                        · {fmt(data.health.last.checkedAt)}
                        {data.health.last.latencyMs !== null ? ` · ${data.health.last.latencyMs} ms` : ''}
                      </p>
                      <p className="mt-1 text-app-text-secondary">{data.health.last.detail}</p>
                      <p className="mt-1 text-xs text-app-text-muted">
                        Uptime {data.health.uptimePercent ?? '—'}% over the last {data.health.total} checks (production).
                      </p>
                    </div>
                  ) : (
                    <Empty>No health checks recorded yet.</Empty>
                  )}
                  <div className="mt-3">
                    {ownerOnly(
                      <button
                        type="button"
                        disabled={pending}
                        className={btn}
                        onClick={() =>
                          run(
                            () => opsRunHealthCheckAction(projectId),
                            (r) => `Health check finished: ${String(r.detail)}`,
                          )
                        }>
                        {pending ? 'Working…' : 'Run check now'}
                      </button>,
                    )}
                  </div>
                </Card>
                <Card title="Domains & SSL">
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-app-text-muted">Subdomain</dt>
                      <dd className="break-all">{data.domains.subdomain ?? 'Not set'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-app-text-muted">Custom domain</dt>
                      <dd className="break-all">
                        {data.domains.custom
                          ? `${data.domains.custom.domain} · ${data.domains.custom.verified ? 'DNS verified' : 'DNS verification pending'}`
                          : 'Not set'}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <Unavailable>
                      SSL certificate status and expiry are issued by the hosting provider and are not checked by this dashboard.
                    </Unavailable>
                  </div>
                </Card>
              </div>
            </>
          ) : null}

          {tab === 'versions' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Checkpoints">
                {data.versions.checkpoints.length === 0 ? (
                  <Empty>No checkpoints yet. They are created automatically after agent turns or when you save one in the editor.</Empty>
                ) : (
                  <ul className="max-h-96 space-y-2 overflow-y-auto">
                    {data.versions.checkpoints.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-app-border-subtle p-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.label}</p>
                          <p className="text-xs text-app-text-muted">
                            {fmt(c.createdAt)} · {c.fileCount} files · {c.isAutomatic ? 'automatic' : 'manual'}
                          </p>
                        </div>
                        {ownerOnly(
                          <button
                            type="button"
                            disabled={pending}
                            className={btn}
                            onClick={() =>
                              run(
                                () => opsRestoreCheckpointAction(projectId, c.id),
                                'Checkpoint restored. Your previous state was saved as a new checkpoint.',
                                `Restore "${c.label}"? Current files will be replaced (a backup checkpoint is made first).`,
                              )
                            }>
                            Restore
                          </button>,
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <div className="space-y-4">
                <Card title="GitHub sync">
                  {data.github ? (
                    <div className="text-sm">
                      <a href={data.github.htmlUrl} target="_blank" rel="noreferrer" className="font-medium text-app-accent hover:underline">
                        {data.github.repoFullName}
                      </a>
                      <p className="text-app-text-secondary">
                        Branch {data.github.defaultBranch} · {data.github.private ? 'private' : 'public'} · last sync {fmt(data.github.lastSyncedAt)}
                      </p>
                    </div>
                  ) : (
                    <Empty>This project is not connected to a GitHub repository.</Empty>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!githubAccount ? (
                      <p className="text-xs text-app-text-muted">
                        Connect your GitHub account in <Link href="/app/account" className="underline">account settings</Link> first.
                      </p>
                    ) : (
                      ownerOnly(
                        <button
                          type="button"
                          disabled={pending}
                          className={btn}
                          onClick={() =>
                            run(
                              () => opsPushGithubAction(projectId),
                              (r) => `Pushed to ${String(r.repo)}.`,
                              data.github ? undefined : 'Create a private GitHub repository for this project and push the files?',
                            )
                          }>
                          {data.github ? 'Push to GitHub' : 'Connect & push'}
                        </button>,
                      )
                    )}
                    {githubAccount ? <span className="text-xs text-app-text-muted">Signed in as {githubAccount}</span> : null}
                  </div>
                </Card>
                <Card title="Source code export">
                  {data.versions.artifacts.length === 0 ? (
                    <Empty>Nothing to export yet. Ask the agent to build your project first.</Empty>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {data.versions.artifacts.map((a) => (
                        <li key={a.slug} className="flex items-center justify-between gap-3">
                          <span className="truncate">{a.name}</span>
                          <a href={`/api/projects/${projectId}/artifacts/${a.slug}/download`} className={btn} download>
                            Download .zip
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          ) : null}

          {tab === 'data' ? (
            <div className="space-y-4">
              <Card title="Project databases">
                {data.databases.length === 0 ? (
                  <Empty>No managed database has been provisioned for this project.</Empty>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.databases.map((db) => (
                      <li key={db.environment} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-app-border-subtle p-2.5">
                        <span className="font-medium">{db.environment.toLowerCase()}</span>
                        <span className="text-app-text-secondary">{db.provider.toLowerCase()} · {db.databaseName}</span>
                        <span className="text-xs text-app-text-muted">
                          {db.isActive ? 'active' : 'inactive'} · provisioned {fmt(db.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Migrations">
                <Unavailable>Applied migrations are not tracked for project databases.</Unavailable>
              </Card>
              <Card title="Backups">
                <Unavailable>
                  Per-project database backups are not available. Platform backups run for the whole service, not per project.
                </Unavailable>
              </Card>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DeploymentRow({
  d,
  isOwner,
  pending,
  onRollback,
  btn,
}: {
  d: OpsDeploymentRow;
  isOwner: boolean;
  pending: boolean;
  onRollback: () => void;
  btn: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-app-border-subtle align-top">
        <td className="py-2 pr-3 font-medium">
          v{d.version}
          {d.promotedFromVersion ? <span className="block text-xs font-normal text-app-text-muted">from staging v{d.promotedFromVersion}</span> : null}
        </td>
        <td className="pr-3 capitalize">{d.environment.toLowerCase()}</td>
        <td className="pr-3">
          <StatusBadge status={d.status} />
          {d.isLive ? <span className="ml-1 text-xs text-emerald-300">current</span> : null}
        </td>
        <td className="pr-3">{formatDuration(d.durationMs)}</td>
        <td className="pr-3">{fmt(d.createdAt)}</td>
        <td>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-expanded={open} className={btn} onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide log' : 'View log'}
            </button>
            {isOwner && d.canRollback ? (
              <button type="button" disabled={pending} className={btn} onClick={onRollback}>
                Roll back
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="pb-3">
            <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-app-text-secondary" aria-label={`Event log for v${d.version}`}>
              {[
                `${fmt(d.createdAt)}  deployment v${d.version} created by ${d.createdByName ?? 'unknown'} (${d.environment.toLowerCase()}, ${d.visibility.toLowerCase()})`,
                d.promotedFromVersion ? `                    promoted from staging v${d.promotedFromVersion}` : null,
                d.publishedAt ? `${fmt(d.publishedAt)}  published` : null,
                `${fmt(d.updatedAt)}  status: ${d.status.toLowerCase()}`,
                '',
                'Build output is not stored for deployments, so only this event record is available.',
              ]
                .filter((line) => line !== null)
                .join('\n')}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

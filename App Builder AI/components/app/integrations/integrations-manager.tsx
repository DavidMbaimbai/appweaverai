'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  listConnectionsAction,
  testIntegrationAction,
} from '@/lib/actions/integrations';
import { INTEGRATION_CATEGORIES, type PublicIntegration } from '@/lib/integrations/catalogue/types';
import type { ConnectionView } from '@/lib/integrations/service';

import { WebhooksPanel } from './webhooks-panel';

const HEALTH_STYLE: Record<string, string> = {
  HEALTHY: 'bg-emerald-600/20 text-emerald-300',
  DEGRADED: 'bg-yellow-600/20 text-yellow-300',
  DOWN: 'bg-red-600/20 text-red-300',
  UNKNOWN: 'bg-app-surface text-app-text-muted',
};

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  isOwner: boolean;
  catalogue: PublicIntegration[];
  initialConnections: ConnectionView[];
};

function Mark({ def }: { def: Pick<PublicIntegration, 'mark' | 'color'> }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
      style={{ backgroundColor: def.color }}
      aria-hidden
    >
      {def.mark}
    </span>
  );
}

export function IntegrationsManager({ projectId, projectName, builderHref, isOwner, catalogue, initialConnections }: Props) {
  const [connections, setConnections] = useState(initialConnections);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byConnection = useMemo(() => new Map(connections.map((c) => [c.integrationId, c])), [connections]);
  const selected = catalogue.find((c) => c.id === selectedId) ?? null;

  const filtered = catalogue.filter((c) => {
    if (category === 'Connected' && !byConnection.has(c.id)) return false;
    if (category !== 'All' && category !== 'Connected' && c.category !== category) return false;
    const q = query.trim().toLowerCase();
    return !q || `${c.name} ${c.description} ${c.category}`.toLowerCase().includes(q);
  });

  function upsert(connection: ConnectionView) {
    setConnections((current) => [...current.filter((c) => c.integrationId !== connection.integrationId), connection]);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href={builderHref} className="text-sm text-app-text-secondary hover:underline">
        ← Back to {projectName}
      </Link>
      <h1 className="mt-3 text-xl font-semibold">Integrations</h1>
      <p className="text-sm text-app-text-secondary">
        Connect services to {projectName}. Credentials are encrypted, stored as server-side environment variables, and never sent to
        browsers or generated frontend code.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search integrations"
          aria-label="Search integrations"
          className="w-full max-w-xs rounded-lg border border-app-border-subtle bg-app-bg px-3 py-2 text-sm"
        />
        {['All', 'Connected', ...INTEGRATION_CATEGORIES].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setCategory(name)}
            className={`rounded-full border px-3 py-1 text-xs ${
              category === name ? 'border-app-accent-blue bg-app-surface-active text-app-text' : 'border-app-border-subtle text-app-text-secondary hover:bg-app-surface-hover'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((def) => {
          const connection = byConnection.get(def.id);
          return (
            <div key={def.id} className="flex flex-col justify-between rounded-xl border border-app-border-subtle p-4">
              <div className="flex gap-3">
                <Mark def={def} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium">{def.name}</h2>
                    {def.status === 'coming_soon' ? (
                      <span className="rounded-full bg-app-surface px-2 py-0.5 text-[11px] text-app-text-muted">Coming soon</span>
                    ) : null}
                    {def.disabled ? <span className="rounded-full bg-red-600/20 px-2 py-0.5 text-[11px] text-red-300">Disabled</span> : null}
                    {connection ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${HEALTH_STYLE[connection.healthStatus] ?? HEALTH_STYLE.UNKNOWN}`}>
                        {connection.healthStatus.toLowerCase()}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-app-text-muted">{def.category}</p>
                  <p className="mt-1 text-sm text-app-text-secondary">{def.description}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" onClick={() => setSelectedId(def.id)} className="text-xs text-app-accent-blue hover:underline">
                  Learn more
                </button>
                {def.status === 'available' && !def.disabled ? (
                  <button
                    type="button"
                    onClick={() => setSelectedId(def.id)}
                    className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover"
                  >
                    {def.platformFeature ? 'Open' : connection ? 'Manage' : 'Connect'}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 ? <p className="text-sm text-app-text-secondary">No integrations match your search.</p> : null}
      </div>

      {selected ? (
        <DetailPanel
          key={selected.id}
          def={selected}
          projectId={projectId}
          isOwner={isOwner}
          connection={byConnection.get(selected.id)}
          onClose={() => setSelectedId(null)}
          onSaved={upsert}
          onRemoved={() => setConnections((current) => current.filter((c) => c.integrationId !== selected.id))}
        />
      ) : null}
    </div>
  );
}

function DetailPanel({
  def,
  projectId,
  isOwner,
  connection,
  onClose,
  onSaved,
  onRemoved,
}: {
  def: PublicIntegration;
  projectId: string;
  isOwner: boolean;
  connection: ConnectionView | undefined;
  onClose: () => void;
  onSaved: (c: ConnectionView) => void;
  onRemoved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [reconnect, setReconnect] = useState(false);

  const showForm = def.status === 'available' && !def.disabled && !def.platformFeature && (!connection || reconnect);

  function connect() {
    start(async () => {
      setMessage(null);
      const res = await connectIntegrationAction(projectId, def.id, values);
      if ('error' in res) {
        setMessage({ ok: false, text: res.error });
        return;
      }
      setValues({});
      setReconnect(false);
      onSaved(res.connection);
      setMessage({ ok: res.test.ok, text: `${res.test.ok ? 'Connected. ' : 'Saved, but the test failed. '}${res.test.message} (${res.test.latencyMs} ms)` });
    });
  }

  function test() {
    start(async () => {
      const res = await testIntegrationAction(projectId, def.id);
      if ('error' in res) {
        setMessage({ ok: false, text: res.error });
        return;
      }
      setMessage({ ok: res.ok, text: `${res.message} (${res.latencyMs} ms)` });
      const list = await listConnectionsAction(projectId);
      const fresh = 'connections' in list ? list.connections.find((c) => c.integrationId === def.id) : undefined;
      if (fresh) onSaved(fresh);
    });
  }

  function disconnect() {
    if (!window.confirm(`Disconnect ${def.name}? Its stored credentials and environment variables will be deleted.`)) return;
    start(async () => {
      const res = await disconnectIntegrationAction(projectId, def.id);
      if ('error' in res) setMessage({ ok: false, text: res.error });
      else {
        onRemoved();
        setMessage({ ok: true, text: 'Disconnected and credentials deleted.' });
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={def.name}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-app-border-subtle bg-app-bg p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <Mark def={def} />
            <div>
              <h2 className="text-lg font-semibold">{def.name}</h2>
              <p className="text-xs text-app-text-muted">
                {def.category} · {def.authType.replace('_', ' ')}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-app-text-secondary hover:underline">
            Close
          </button>
        </div>
        <p className="mt-3 text-sm text-app-text-secondary">{def.description}</p>

        {def.status === 'coming_soon' ? (
          <p className="mt-4 rounded-lg bg-app-surface p-3 text-sm text-app-text-secondary">
            Coming soon. This integration is listed for planning only and cannot be connected yet.
          </p>
        ) : null}
        {def.disabled ? (
          <p className="mt-4 rounded-lg bg-red-600/10 p-3 text-sm text-red-300">
            Temporarily disabled{def.disabledReason ? `: ${def.disabledReason}` : '.'}
          </p>
        ) : null}

        {def.scopes.length ? (
          <section className="mt-4">
            <h3 className="text-sm font-medium">Permissions needed</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-app-text-secondary">
              {def.scopes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {def.warnings?.length ? (
          <section className="mt-4 rounded-lg border border-yellow-600/40 bg-yellow-600/10 p-3">
            <h3 className="text-sm font-medium text-yellow-300">Read before connecting</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-yellow-100/90">
              {def.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-4 text-sm text-app-text-secondary">
          <span className="font-medium text-app-text">Cost: </span>
          {def.costNote}
        </p>
        <a href={def.docsUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-sm text-app-accent-blue hover:underline">
          Learn more ↗
        </a>

        {def.platformFeature ? <WebhooksPanel projectId={projectId} kind={def.platformFeature} isOwner={isOwner} /> : null}

        {connection ? (
          <section className="mt-5 rounded-lg border border-app-border-subtle p-3 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Connection</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${HEALTH_STYLE[connection.healthStatus] ?? HEALTH_STYLE.UNKNOWN}`}>
                {connection.healthStatus.toLowerCase()}
              </span>
            </div>
            <dl className="mt-2 space-y-1 text-app-text-secondary">
              {Object.entries(connection.maskedHints).map(([key, hint]) => (
                <div key={key} className="flex justify-between gap-2">
                  <dt>{def.fields.find((f) => f.key === key)?.label ?? key}</dt>
                  <dd className="font-mono">{hint}</dd>
                </div>
              ))}
              {connection.envVars.length ? (
                <div>
                  <dt>Server-side env vars</dt>
                  <dd className="font-mono text-xs">{connection.envVars.join(', ')}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt>Last test</dt>
                <dd>
                  {connection.lastTestAt
                    ? `${connection.lastTestOk ? 'passed' : 'failed'} · ${connection.lastTestLatencyMs ?? 0} ms · ${new Date(connection.lastTestAt).toLocaleString()}`
                    : 'never'}
                </dd>
              </div>
              {connection.lastTestError ? <div className="text-red-300">{connection.lastTestError}</div> : null}
              <div className="flex justify-between">
                <dt>Last used</dt>
                <dd>{connection.lastUsedAt ? new Date(connection.lastUsedAt).toLocaleString() : 'not used yet'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Proxied calls</dt>
                <dd>{connection.usageCount}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-app-text-muted">
              Estimated cost: not metered by AppWeaver. Usage is billed by {def.name}; see the cost note above.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={test} className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover disabled:opacity-50">
                {pending ? 'Working…' : 'Test connection'}
              </button>
              {isOwner ? (
                <>
                  <button type="button" disabled={pending} onClick={() => setReconnect((v) => !v)} className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover disabled:opacity-50">
                    {reconnect ? 'Cancel update' : 'Update credentials'}
                  </button>
                  <button type="button" disabled={pending} onClick={disconnect} className="rounded-full border border-red-600/50 px-3 py-1 text-xs text-red-300 hover:bg-red-600/10 disabled:opacity-50">
                    Disconnect
                  </button>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {showForm && isOwner ? (
          <form
            className="mt-5 space-y-3"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              connect();
            }}
          >
            <h3 className="text-sm font-medium">{connection ? 'Update credentials' : `Connect ${def.name}`}</h3>
            {def.fields.map((field) => (
              <label key={field.key} className="block text-sm">
                <span className="text-app-text-secondary">
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                {field.options ? (
                  <select
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-app-border-subtle bg-app-bg px-3 py-2"
                  >
                    <option value="">Select…</option>
                    {field.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    spellCheck={false}
                    value={values[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-app-border-subtle bg-app-bg px-3 py-2 font-mono text-xs"
                  />
                )}
                {field.help ? <span className="text-xs text-app-text-muted">{field.help}</span> : null}
              </label>
            ))}
            <button type="submit" disabled={pending} className="rounded-full bg-app-accent-blue px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {pending ? 'Connecting…' : 'Connect and test'}
            </button>
          </form>
        ) : null}
        {showForm && !isOwner ? <p className="mt-5 text-sm text-app-text-secondary">Only the project owner can connect integrations.</p> : null}

        {message ? <p className={`mt-3 text-sm ${message.ok ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p> : null}

        {def.setup ? (
          <section className="mt-6">
            <h3 className="text-sm font-medium">Use it in your app</h3>
            {def.setup.note ? <p className="text-xs text-app-text-muted">{def.setup.note}</p> : null}
            <pre className="mt-2 overflow-x-auto rounded-lg bg-app-surface p-3 text-xs">
              <code>{def.setup.snippet}</code>
            </pre>
          </section>
        ) : null}
      </div>
    </div>
  );
}

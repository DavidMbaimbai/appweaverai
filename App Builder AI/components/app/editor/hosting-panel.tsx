'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  getDeploymentHistoryAction,
  rollbackDeploymentAction,
  type DeploymentHistoryItem,
} from '@/lib/actions/deployments';
import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type Tab = 'deployments' | 'subdomain' | 'environment';

type HealthSummary = {
  last: {
    ok: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    detail: string;
    checkedAt: string;
  } | null;
  total: number;
  passed: number;
  uptimePercent: number | null;
};

type EnvVar = { key: string; masked: string; managed: boolean; updatedAt: string };

type HostingPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onRolledBack?: () => void;
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'subdomain', label: 'Subdomain' },
  { id: 'environment', label: 'Environment' },
];

async function api<T>(url: string, init?: RequestInit): Promise<T & { error?: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  return res.json();
}

function DeploymentsTab({
  projectId,
  onRolledBack,
}: {
  projectId: string;
  onRolledBack?: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<DeploymentHistoryItem[] | null>(null);
  const [retained, setRetained] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await getDeploymentHistoryAction(projectId);
      if (cancelled) return;
      if ('deployments' in result && result.deployments) {
        setItems(result.deployments);
        setRetained(result.retained ?? null);
      } else if (result.error) {
        toastError(result.error);
      }
      const summary = await api<HealthSummary>(`/api/projects/${projectId}/health`);
      if (!cancelled && !summary.error) setHealth(summary);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey, toastError]);

  async function runCheck() {
    setIsChecking(true);
    try {
      const data = await api<HealthSummary>(`/api/projects/${projectId}/health`, {
        method: 'POST',
      });
      if (data.error) toastError(data.error);
      else setHealth(data);
    } catch {
      toastError('Could not run the health check.');
    } finally {
      setIsChecking(false);
    }
  }

  function rollback(item: DeploymentHistoryItem) {
    startTransition(async () => {
      const result = await rollbackDeploymentAction(projectId, item.id);
      if ('error' in result && result.error) {
        toastError(result.error);
        return;
      }
      success(`Rolled back to v${item.version}.`);
      onRolledBack?.();
      setReloadKey((key) => key + 1);
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-xl border border-app-border-subtle px-4 py-3 text-xs text-app-text-secondary">
        <div className="flex items-center justify-between">
          <p className="font-medium text-app-text">Health</p>
          <Button
            type="button"
            theme="app"
            variant="secondary"
            disabled={isChecking}
            onClick={runCheck}>
            {isChecking ? 'Checking…' : 'Check now'}
          </Button>
        </div>
        {health?.last ? (
          <>
            <p>
              Last check {new Date(health.last.checkedAt).toLocaleString()}:{' '}
              <span className={health.last.ok ? 'text-emerald-400' : 'text-red-400'}>
                {health.last.ok ? 'Healthy' : 'Unhealthy'}
              </span>
            </p>
            <p className="text-app-text-muted">{health.last.detail}</p>
            {health.uptimePercent !== null ? (
              <p>
                Uptime across your last {health.total} manual check
                {health.total === 1 ? '' : 's'}: {health.uptimePercent}% (
                {health.passed}/{health.total} passed)
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-app-text-muted">
            No checks yet. Checks run only when you press “Check now”; there is
            no continuous monitoring.
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs text-app-text-muted">
          {retained
            ? `Your plan keeps the latest ${retained} deployments for rollback.`
            : ''}
        </p>
        {items === null ? (
          <p className="py-4 text-center text-sm text-app-text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-app-text-muted">
            Nothing published yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-2.5">
                <div className="text-xs text-app-text-secondary">
                  <p className="text-sm font-medium text-app-text">
                    v{item.version}
                    {item.isCurrent ? ' · live' : ''}
                  </p>
                  <p>
                    {item.status.toLowerCase()} · {item.visibility} ·{' '}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                {item.canRollback ? (
                  <Button
                    type="button"
                    theme="app"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => rollback(item)}>
                    Roll back to this
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SubdomainTab({ projectId }: { projectId: string }) {
  const { success, error: toastError } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [rootDomain, setRootDomain] = useState('');
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const data = await api<{
        subdomain: { host: string; subdomain: string } | null;
        rootDomain: string;
        suggestion: string | null;
      }>(`/api/projects/${projectId}/subdomain`);
      setCurrent(data.subdomain?.subdomain ?? null);
      setRootDomain(data.rootDomain);
      setValue(data.subdomain?.subdomain ?? data.suggestion ?? '');
      setLoaded(true);
    })();
  }, [projectId]);

  async function save() {
    setIsSaving(true);
    try {
      const data = await api<{ subdomain: { subdomain: string } }>(
        `/api/projects/${projectId}/subdomain`,
        { method: 'PUT', body: JSON.stringify({ subdomain: value }) },
      );
      if (data.error) {
        toastError(data.error);
        return;
      }
      setCurrent(data.subdomain.subdomain);
      success('Subdomain saved.');
    } catch {
      toastError('Could not save the subdomain.');
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    await api(`/api/projects/${projectId}/subdomain`, { method: 'DELETE' });
    setCurrent(null);
    success('Subdomain released.');
  }

  if (!loaded) {
    return <p className="py-4 text-center text-sm text-app-text-muted">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-text-secondary">
        Serve your published site at a free address on {rootDomain}. It works
        once the site is published publicly.
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="my-app"
          theme="app"
          className="h-9 flex-1"
        />
        <span className="text-xs text-app-text-muted">.{rootDomain}</span>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          theme="app"
          className="flex-1"
          disabled={isSaving || !value.trim() || value.trim() === current}
          onClick={save}>
          {isSaving ? 'Saving…' : current ? 'Change subdomain' : 'Claim subdomain'}
        </Button>
        {current ? (
          <Button type="button" theme="app" variant="secondary" onClick={remove}>
            Release
          </Button>
        ) : null}
      </div>
      {current ? (
        <p className="break-all text-xs text-app-text-muted">
          Live at https://{current}.{rootDomain}
        </p>
      ) : null}
    </div>
  );
}

function EnvironmentTab({ projectId }: { projectId: string }) {
  const { success, error: toastError } = useToast();
  const [environment, setEnvironment] = useState<'PRODUCTION' | 'DEVELOPMENT'>('PRODUCTION');
  const [vars, setVars] = useState<EnvVar[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await api<{ variables: EnvVar[]; limit: number }>(
        `/api/projects/${projectId}/env?environment=${environment}`,
      );
      if (cancelled) return;
      setVars(data.variables ?? []);
      setLimit(data.limit ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, environment]);

  async function save() {
    setIsSaving(true);
    try {
      const data = await api<{ variables: EnvVar[] }>(`/api/projects/${projectId}/env`, {
        method: 'PUT',
        body: JSON.stringify({ environment, key: name, value }),
      });
      if (data.error) {
        toastError(data.error);
        return;
      }
      setVars(data.variables);
      setName('');
      setValue('');
      success('Variable saved (encrypted).');
    } catch {
      toastError('Could not save the variable.');
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(key: string) {
    const data = await api<{ variables: EnvVar[] }>(`/api/projects/${projectId}/env`, {
      method: 'DELETE',
      body: JSON.stringify({ environment, key }),
    });
    if (data.error) toastError(data.error);
    else setVars(data.variables);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['PRODUCTION', 'DEVELOPMENT'] as const).map((env) => (
          <button
            key={env}
            type="button"
            onClick={() => {
              setVars(null);
              setEnvironment(env);
            }}
            className={
              env === environment
                ? 'rounded-full bg-app-surface-hover px-3 py-1 text-xs font-medium text-app-text'
                : 'rounded-full px-3 py-1 text-xs text-app-text-muted hover:text-app-text'
            }>
            {env === 'PRODUCTION' ? 'Production' : 'Development'}
          </button>
        ))}
      </div>
      <p className="text-xs text-app-text-muted">
        Values are encrypted and never shown again after saving; only names are
        listed. There is no separate staging environment: Development is for
        the editor, Production is for your published app.
        {limit !== null ? ` Limit: ${limit} variables per environment.` : ''}
      </p>

      {vars === null ? (
        <p className="py-2 text-center text-sm text-app-text-muted">Loading…</p>
      ) : vars.length === 0 ? (
        <p className="py-2 text-sm text-app-text-muted">No variables yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {vars.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between rounded-lg bg-app-surface-active px-3 py-2 font-mono text-xs text-app-text-secondary">
              <span className="truncate">
                {item.key} = {item.masked}
              </span>
              {item.managed ? (
                <span className="font-sans text-app-text-muted">managed</span>
              ) : (
                <button
                  type="button"
                  onClick={() => remove(item.key)}
                  className="font-sans text-red-400 hover:text-red-300">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-app-border-subtle pt-3">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase())}
          placeholder="API_KEY"
          theme="app"
          className="h-9 w-full font-mono"
        />
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Value (setting an existing name replaces it)"
          type="password"
          autoComplete="off"
          theme="app"
          className="h-9 w-full"
        />
        <Button
          type="button"
          theme="app"
          className="w-full"
          disabled={isSaving || !name.trim() || !value}
          onClick={save}>
          {isSaving ? 'Saving…' : 'Save variable'}
        </Button>
      </div>
    </div>
  );
}

export function HostingPanel({ open, onClose, projectId, onRolledBack }: HostingPanelProps) {
  const [tab, setTab] = useState<Tab>('deployments');

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">Hosting</h2>
            <div className="mt-2 flex gap-3">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={
                    item.id === tab
                      ? 'text-xs font-medium text-appweaver-orange'
                      : 'text-xs text-app-text-muted hover:text-app-text'
                  }>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {open && tab === 'deployments' ? (
            <DeploymentsTab projectId={projectId} onRolledBack={onRolledBack} />
          ) : null}
          {open && tab === 'subdomain' ? <SubdomainTab projectId={projectId} /> : null}
          {open && tab === 'environment' ? <EnvironmentTab projectId={projectId} /> : null}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

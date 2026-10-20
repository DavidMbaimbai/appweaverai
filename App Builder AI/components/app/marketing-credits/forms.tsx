'use client';

import { useState, useTransition } from 'react';

import { buyMarketingPackageAction, saveProjectBudgetAction } from '@/lib/actions/marketing-credits';

export function BuyPackageButton({ packageId, label }: { packageId: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await buyMarketingPackageAction(packageId);
            if ('url' in res && res.url) window.location.href = res.url;
            else setError(('error' in res && res.error) || 'Could not start checkout.');
          })
        }
        className="rounded-lg bg-app-text px-3 py-1.5 text-sm font-medium text-app-bg disabled:opacity-50">
        {pending ? 'Opening…' : label}
      </button>
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

export function BudgetForm({
  projectId,
  name,
  limits,
  pausedReason,
}: {
  projectId: string;
  name: string;
  limits: { dayLimit: number | null; weekLimit: number | null; monthLimit: number | null };
  pausedReason: string | null;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const field = 'w-24 rounded-md border border-app-border-subtle bg-app-bg px-2 py-1 text-sm text-app-text';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        start(async () => {
          const res = await saveProjectBudgetAction(projectId, data);
          setMessage('error' in res && res.error ? res.error : 'Saved. Scheduled jobs resumed.');
        });
      }}
      className="flex flex-wrap items-end gap-2 rounded-xl border border-app-border-subtle bg-app-surface p-3">
      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium text-app-text">{name}</p>
        {pausedReason ? <p className="text-xs text-amber-500">Paused: {pausedReason}</p> : null}
      </div>
      {(['dayLimit', 'weekLimit', 'monthLimit'] as const).map((key) => (
        <label key={key} className="text-xs text-app-text-muted">
          {key.replace('Limit', '')}
          <input name={key} type="number" min={0} defaultValue={limits[key] ?? ''} placeholder="none" className={`${field} block`} />
        </label>
      ))}
      <button disabled={pending} className="rounded-md bg-app-text px-3 py-1 text-sm font-medium text-app-bg disabled:opacity-50">
        Save
      </button>
      {message ? <p className="w-full text-xs text-app-text-muted">{message}</p> : null}
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';

import { setSpendLimitAction } from '@/lib/actions/credit-controls';

export type LimitFormWorkspace = { id: string; name: string; limit: number | null };

function LimitRow({
  label,
  initial,
  save,
}: {
  label: string;
  initial: number | null;
  save: (limit: number | null) => ReturnType<typeof setSpendLimitAction>;
}) {
  const [value, setValue] = useState(initial?.toString() ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        startTransition(async () => {
          const result = await save(trimmed === '' ? null : Number(trimmed));
          setMessage('error' in result ? result.error : 'Saved.');
        });
      }}>
      <label className="w-48 text-app-text">{label}</label>
      <input
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="No limit"
        aria-label={`${label} monthly limit in credits`}
        className="w-32 rounded-md border border-app-border-subtle bg-app-bg px-2 py-1 text-app-text"
      />
      <button disabled={pending} className="rounded-md bg-app-text px-3 py-1 text-app-bg disabled:opacity-50">
        Save
      </button>
      {message ? <span className="text-xs text-app-text-muted">{message}</span> : null}
    </form>
  );
}

export function SpendLimitForm({ userLimit, workspaces }: { userLimit: number | null; workspaces: LimitFormWorkspace[] }) {
  return (
    <div className="space-y-2">
      <LimitRow label="Your monthly limit" initial={userLimit} save={(limit) => setSpendLimitAction({ scope: 'USER', monthlyLimit: limit })} />
      {workspaces.map((w) => (
        <LimitRow
          key={w.id}
          label={`${w.name} (workspace)`}
          initial={w.limit}
          save={(limit) => setSpendLimitAction({ scope: 'WORKSPACE', workspaceId: w.id, monthlyLimit: limit })}
        />
      ))}
    </div>
  );
}

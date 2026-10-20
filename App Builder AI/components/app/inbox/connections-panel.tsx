'use client';

import { useState, useTransition } from 'react';

import { removeChannelConnectionAction, saveChannelConnectionAction } from '@/lib/actions/inbox';
import { PROJECT_CONNECTION_FIELDS_VIEW } from '@/lib/messaging/connection-fields';
import { CHANNEL_LABELS, type MessageChannelName } from '@/lib/messaging/types';

const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';
const field = 'w-full rounded-lg border border-app-border bg-transparent px-2 py-1.5 text-sm text-app-text';

function ConnectionForm({ projectId, channel }: { projectId: string; channel: MessageChannelName }) {
  const fields = PROJECT_CONNECTION_FIELDS_VIEW[channel] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  return (
    <details className="rounded-xl border border-app-border-subtle p-3">
      <summary className="cursor-pointer text-sm font-medium text-app-text">{CHANNEL_LABELS[channel]} connection</summary>
      <div className="mt-2 space-y-2">
        {fields.map((f) => (
          <label key={f.key} className="block text-xs text-app-text-muted">
            {f.label}
            <input
              className={field}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="flex gap-2">
          <button
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveChannelConnectionAction(projectId, channel, values);
                setMessage(r.ok ? (r.message ?? 'Saved.') : r.error);
                if (r.ok) setValues({});
              })
            }>
            Save
          </button>
          <button
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeChannelConnectionAction(projectId, channel);
                setMessage(r.ok ? 'Removed.' : r.error);
              })
            }>
            Remove
          </button>
        </div>
        {message ? <p className="text-xs text-app-text-muted">{message}</p> : null}
        <p className="text-xs text-app-text-muted">Secrets are encrypted at rest and never shown again.</p>
      </div>
    </details>
  );
}

export function ConnectionsPanel({ projectId, widgetSnippet }: { projectId: string; widgetSnippet: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-app-text">Connect your channels</h2>
      <div className="rounded-xl border border-app-border-subtle p-3 text-xs text-app-text-muted">
        Web chat widget: paste before {'</body>'} on your site.
        <pre className="mt-1 overflow-auto rounded bg-app-border-subtle p-2 text-app-text">{widgetSnippet}</pre>
      </div>
      {(['WHATSAPP', 'SMS', 'FACEBOOK', 'INSTAGRAM'] as const).map((c) => (
        <ConnectionForm key={c} projectId={projectId} channel={c} />
      ))}
    </section>
  );
}

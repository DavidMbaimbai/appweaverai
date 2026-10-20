'use client';

import { useState, useTransition } from 'react';

import { createUtmLinkAction, runRollupAction, saveActivationAction } from '@/lib/admin/actions/growth';

const input = 'w-full rounded-md border border-app-border-subtle bg-transparent px-2 py-1 text-xs text-app-text';

export function UtmBuilder() {
  const [out, setOut] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      action={(fd) =>
        start(async () => {
          const r = await createUtmLinkAction({
            baseUrl: String(fd.get('baseUrl') ?? ''),
            source: String(fd.get('source') ?? ''),
            medium: String(fd.get('medium') ?? ''),
            campaign: String(fd.get('campaign') ?? ''),
            content: String(fd.get('content') ?? '') || undefined,
            kind: String(fd.get('kind') ?? 'OTHER'),
            label: String(fd.get('label') ?? '') || undefined,
          });
          setOut(r.ok ? (r.url ?? '') : r.error);
        })
      }>
      <input name="baseUrl" required placeholder="https://appweaverai.com/" className={`${input} sm:col-span-2`} aria-label="Landing URL" />
      <input name="source" required placeholder="source (e.g. linkedin)" className={input} aria-label="UTM source" />
      <input name="medium" required placeholder="medium (e.g. social)" className={input} aria-label="UTM medium" />
      <input name="campaign" required placeholder="campaign" className={input} aria-label="UTM campaign" />
      <input name="content" placeholder="content (optional)" className={input} aria-label="UTM content" />
      <select name="kind" className={input} aria-label="Link kind" defaultValue="SOCIAL_POST">
        <option value="HOUSE_AD">House ad</option>
        <option value="SOCIAL_POST">Social post</option>
        <option value="INVESTOR_OUTREACH">Investor outreach</option>
        <option value="OTHER">Other</option>
      </select>
      <input name="label" placeholder="label (optional)" className={input} aria-label="Label" />
      <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 sm:col-span-2">
        Create and record link
      </button>
      {out ? <p className="break-all text-xs text-app-text-secondary sm:col-span-2" role="status">{out}</p> : null}
    </form>
  );
}

export function ActivationForm({ requireBuild, output }: { requireBuild: boolean; output: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-3 text-xs text-app-text"
      action={(fd) =>
        start(async () => {
          const r = await saveActivationAction({ requireBuild: fd.get('requireBuild') === 'on', output: String(fd.get('output')) });
          setMsg(r.ok ? (r.message ?? 'Saved.') : r.error);
        })
      }>
      <label className="flex items-center gap-1">
        <input type="checkbox" name="requireBuild" defaultChecked={requireBuild} /> First project built
      </label>
      <label className="flex items-center gap-1">
        then
        <select name="output" defaultValue={output} className={input}>
          <option value="preview_or_publish">first preview or publish</option>
          <option value="publish">first publish</option>
          <option value="preview">first preview</option>
          <option value="none">no further step</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded-md border border-app-border-subtle px-2 py-1 disabled:opacity-50">Save</button>
      {msg ? <span role="status" className="text-app-text-secondary">{msg}</span> : null}
    </form>
  );
}

export function RollupButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await runRollupAction(14); setMsg(r.ok ? (r.message ?? 'Done.') : r.error); })}
        className="rounded-md border border-app-border-subtle px-2 py-1 text-app-text disabled:opacity-50">
        Recompute last 14 days
      </button>
      {msg ? <span role="status" className="text-app-text-secondary">{msg}</span> : null}
    </span>
  );
}

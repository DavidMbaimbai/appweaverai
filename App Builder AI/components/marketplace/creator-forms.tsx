'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { becomeCreatorAction, submitAssetAction } from '@/lib/actions/marketplace';
import { ASSET_TYPES, LICENSES, TYPE_LABELS } from '@/lib/marketplace/types';

const FIELD = 'w-full rounded-lg border border-white/20 bg-transparent px-3 py-2 text-sm';
const BTN = 'rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50';

export function BecomeCreatorForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await becomeCreatorAction(name, terms);
          if ('error' in res) setError(res.error);
          else router.refresh();
        });
      }}>
      <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Creator display name" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />I own or have the right to distribute what I publish, and I accept the marketplace creator terms.
      </label>
      <button className={BTN} disabled={pending} type="submit">
        Create creator profile
      </button>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </form>
  );
}

const SAMPLE = JSON.stringify({ files: [{ path: 'index.html', content: '<h1>Hello</h1>' }] }, null, 2);

export function SubmitAssetForm({ paidEnabled }: { paidEnabled: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ type: 'TEMPLATE', title: '', summary: '', description: '', tags: '', license: 'MIT', price: '0', bundleJson: SAMPLE });
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="max-w-2xl space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const priceCents = Math.round(Number(f.price) * 100);
        start(async () => {
          const res = await submitAssetAction({ ...f, priceCents: Number.isFinite(priceCents) ? priceCents : 0 });
          if ('error' in res) setMsg(res.error);
          else {
            setMsg('Submitted for review. It is published only after the safety scan passes and a moderator approves it.');
            router.refresh();
          }
        });
      }}>
      <select className={FIELD} value={f.type} onChange={set('type')}>
        {ASSET_TYPES.map((t) => (
          <option key={t} value={t} className="text-black">
            {TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input className={FIELD} placeholder="Title" value={f.title} onChange={set('title')} />
      <input className={FIELD} placeholder="One-line summary" value={f.summary} onChange={set('summary')} />
      <textarea className={FIELD} rows={4} placeholder="Description" value={f.description} onChange={set('description')} />
      <input className={FIELD} placeholder="Tags, comma separated" value={f.tags} onChange={set('tags')} />
      <select className={FIELD} value={f.license} onChange={set('license')}>
        {Object.entries(LICENSES).map(([key, l]) => (
          <option key={key} value={key} className="text-black">
            {l.label}
          </option>
        ))}
      </select>
      <input className={FIELD} type="number" min="0" step="0.01" disabled={!paidEnabled} value={f.price} onChange={set('price')} aria-label="Price in dollars" />
      {!paidEnabled ? <p className="text-xs opacity-70">Paid assets are not enabled yet, so new assets must be free.</p> : null}
      <textarea className={`${FIELD} font-mono`} rows={10} value={f.bundleJson} onChange={set('bundleJson')} aria-label="Bundle JSON" />
      <button className={BTN} disabled={pending} type="submit">
        Submit for review
      </button>
      {msg ? <p className="text-sm">{msg}</p> : null}
    </form>
  );
}

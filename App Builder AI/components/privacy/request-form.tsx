'use client';

import { useState } from 'react';

const field = 'w-full rounded-md border border-app-border-subtle bg-app-surface px-3 py-2 text-sm text-app-text';

export function RequestForm() {
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'done' | 'error'; message?: string }>({ status: 'idle' });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'busy' });
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const res = await fetch('/api/privacy/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    setState(res.ok ? { status: 'done', message: body.message } : { status: 'error', message: body.error ?? 'Something went wrong.' });
  }

  if (state.status === 'done') return <p className="text-sm text-app-text">{state.message}</p>;

  return (
    <form onSubmit={submit} className="space-y-3">
      <select name="type" className={field} defaultValue="ACCESS" aria-label="Request type">
        <option value="ACCESS">Access a copy of my data</option>
        <option value="ERASURE">Erase my data</option>
        <option value="RECTIFICATION">Correct my data</option>
        <option value="OBJECTION">Object to processing / stop contacting me</option>
        <option value="OTHER">Other</option>
      </select>
      <input name="name" className={field} placeholder="Your name" maxLength={200} />
      <input name="email" type="email" required className={field} placeholder="Email address (we will send a confirmation link)" maxLength={254} />
      <input name="phone" className={field} placeholder="Phone number (optional)" maxLength={40} />
      <textarea name="details" className={field} rows={4} placeholder="Anything that helps us find your data (optional)" maxLength={4000} />
      <button type="submit" disabled={state.status === 'busy'} className="rounded-full bg-appweaver-orange px-4 py-2 text-sm font-medium text-black disabled:opacity-50">Submit request</button>
      {state.status === 'error' ? <p className="text-sm text-red-400">{state.message}</p> : null}
    </form>
  );
}

'use client';

import { useState } from 'react';

type Slot = { id: string; startsAt: string; durationMin: number };

export function BookingForm({ projectId, projectName, slots }: { projectId: string; projectName: string; slots: Slot[] }) {
  const [slotId, setSlotId] = useState(slots[0]?.id ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  if (!slots.length) return <p>No demo times are available right now. Please check back soon.</p>;
  if (done) return <p role="status">{message}</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId, name, email, phone, consent, website }),
      });
      const body = (await res.json()) as { error?: string };
      if (res.ok) {
        setDone(true);
        setMessage(`Booked! A confirmation email is on its way to ${email}.`);
      } else setMessage(body.error ?? 'Could not book.');
    } catch {
      setMessage('Could not book.');
    }
    setBusy(false);
  }

  const input = 'w-full rounded-md border border-neutral-300 bg-white p-2 text-neutral-900';
  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        Choose a time for your {projectName} demo
        <select className={input} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.startsAt).toLocaleString()} ({s.durationMin} min)
            </option>
          ))}
        </select>
      </label>
      <input className={input} placeholder="Your name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <input className={input} type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className={input} placeholder="Phone (optional)" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I also agree to be contacted by email with follow-ups (optional). Your booking confirmation is sent either way.</span>
      </label>
      <button className="rounded-md bg-neutral-900 p-2 text-white disabled:opacity-50" disabled={busy}>
        {busy ? 'Booking…' : 'Book demo'}
      </button>
      {message ? <p role="alert" className="text-sm text-red-600">{message}</p> : null}
    </form>
  );
}

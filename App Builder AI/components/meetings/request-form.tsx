'use client';

import { useState, useTransition } from 'react';

import { cancelMyMeetingAction, requestMeetingAction } from '@/lib/actions/meetings';

export type MyMeeting = { id: string; title: string; status: string; when: string | null; link: string | null };

export function MeetingRequestForm({ meetings }: { meetings: MyMeeting[] }) {
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await requestMeetingAction({ title, agenda, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setTitle('');
        setAgenda('');
      }
    });
  };

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium">
          What would you like to discuss?
          <input className="mt-1 w-full rounded border px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
        </label>
        <label className="block text-sm font-medium">
          Anything we should know? (optional)
          <textarea className="mt-1 w-full rounded border px-3 py-2" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={2000} />
        </label>
        <button disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
          Request a meeting
        </button>
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm' : 'text-sm text-red-700'}>
            {message.text}
          </p>
        )}
      </form>
      <section>
        <h2 className="mb-2 font-medium">Your meetings</h2>
        {meetings.length === 0 ? (
          <p className="text-sm text-neutral-600">No meetings yet.</p>
        ) : (
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded border p-3 text-sm">
                <span>
                  {m.title} · {m.status.replace(/_/g, ' ').toLowerCase()}
                  {m.when ? ` · ${m.when}` : ''}
                  {m.link ? (
                    <>
                      {' · '}
                      <a className="underline" href={m.link} rel="noopener noreferrer">join</a>
                    </>
                  ) : null}
                </span>
                {!['CANCELLED', 'COMPLETED', 'MISSED', 'FAILED'].includes(m.status) && (
                  <button className="text-red-700 underline" onClick={() => start(async () => void (await cancelMyMeetingAction(m.id)))}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';

import { cancelMeetingByParticipantAction, chooseMeetingTimeAction, requestMeetingRescheduleAction } from '@/lib/actions/meeting-public';

type Slot = { id: string; label: string };

export function ParticipantPanel({ token, status, slots }: { token: string; status: string; slots: Slot[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [slotId, setSlotId] = useState(slots[0]?.id ?? '');

  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });

  if (message?.ok) return <p role="status">{message.text}</p>;
  const live = status === 'CONFIRMED' || status === 'RESCHEDULED';
  const closed = ['CANCELLED', 'COMPLETED', 'MISSED', 'FAILED'].includes(status);

  return (
    <div className="mt-4 space-y-4">
      {slots.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="font-medium">Choose a time</legend>
          {slots.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="slot" value={s.id} checked={slotId === s.id} onChange={() => setSlotId(s.id)} />
              {s.label}
            </label>
          ))}
          <button type="button" disabled={pending || !slotId} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => run(() => chooseMeetingTimeAction(token, slotId))}>
            Confirm this time
          </button>
        </fieldset>
      )}
      {(live || slots.length > 0) && !closed && (
        <div className="flex gap-3">
          <button type="button" disabled={pending} className="rounded border px-3 py-1.5 text-sm" onClick={() => run(() => requestMeetingRescheduleAction(token))}>
            Ask for other times
          </button>
          <button type="button" disabled={pending} className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-700" onClick={() => confirm('Cancel this meeting?') && run(() => cancelMeetingByParticipantAction(token))}>
            Cancel meeting
          </button>
        </div>
      )}
      {closed && <p className="text-sm">This meeting is {status.toLowerCase()}.</p>}
      {message && !message.ok && <p role="alert" className="text-sm text-red-700">{message.text}</p>}
    </div>
  );
}

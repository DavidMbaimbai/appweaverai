'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminMeetingOpAction, platformCalendarOpAction, startPlatformCalendarConnectAction, type MeetingOp, type MeetingOpResult } from '@/lib/admin/actions/meetings';

export type AdminMeeting = {
  id: string;
  title: string;
  status: string;
  category: string;
  when: string | null;
  durationMin: number;
  participants: string;
  agenda: string;
  sourceType: string;
  sourceHref: string | null;
  conferenceUrl: string | null;
  assigneeId: string | null;
  failureReason: string | null;
  internalNotes: string | null;
  outcome: string | null;
  summary: string | null;
  nextSteps: { text: string; sensitive?: boolean; approved?: boolean }[];
  buckets: string[];
};

export type ProviderStatus = { kind: string; available: boolean; reason: string | null };

const SECTIONS: { key: string; title: string }[] = [
  { key: 'today', title: 'Today' },
  { key: 'upcoming', title: 'Upcoming' },
  { key: 'pending', title: 'Pending requests' },
  { key: 'awaiting', title: 'Awaiting confirmation' },
  { key: 'investor', title: 'Investor meetings' },
  { key: 'customer', title: 'User & customer meetings' },
  { key: 'closed', title: 'Completed, cancelled & missed' },
  { key: 'followUps', title: 'Follow-ups' },
];

const btn = 'rounded border px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50';

function MeetingCard({ m, canWrite, canNotes, adminId, run }: { m: AdminMeeting; canWrite: boolean; canNotes: boolean; adminId: string; run: (op: MeetingOp) => void }) {
  const [notes, setNotes] = useState(m.internalNotes ?? '');
  const [when, setWhen] = useState('');
  const [link, setLink] = useState('');
  const [outcome, setOutcome] = useState('');
  const [steps, setSteps] = useState('');
  const closed = ['CANCELLED', 'COMPLETED', 'MISSED', 'FAILED'].includes(m.status);
  return (
    <li className="space-y-2 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{m.title}</strong>
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{m.status.replace(/_/g, ' ')}</span>
      </div>
      <div className="text-neutral-600">
        {m.category.toLowerCase()} · {m.when ?? 'no time set'} · {m.durationMin} min · {m.participants}
      </div>
      {m.agenda && <div>Agenda: {m.agenda}</div>}
      <div className="text-xs text-neutral-600">
        Source: {m.sourceHref ? <a className="underline" href={m.sourceHref}>{m.sourceType.toLowerCase().replace('_', ' ')} record</a> : m.sourceType.toLowerCase().replace('_', ' ')}
        {m.conferenceUrl ? <> · <a className="underline" href={m.conferenceUrl} rel="noopener noreferrer">join link</a></> : ' · no join link'}
        {m.assigneeId ? ` · assigned${m.assigneeId === adminId ? ' to you' : ''}` : ''}
      </div>
      {m.failureReason && <div className="text-xs text-amber-700">Note: {m.failureReason}</div>}
      {m.outcome && <div>Outcome: {m.outcome}</div>}
      {m.summary && <div>Summary: {m.summary}</div>}
      {m.nextSteps.length > 0 && (
        <ul className="list-disc pl-5">
          {m.nextSteps.map((s) => (
            <li key={s.text}>
              {s.text}
              {s.sensitive ? (s.approved ? ' (sensitive, approved)' : ' (sensitive: awaiting approval in Agent activity)') : ''}
            </li>
          ))}
        </ul>
      )}
      {canWrite && !closed && (
        <div className="flex flex-wrap items-center gap-2">
          {['REQUESTED', 'PROPOSED', 'AWAITING_CONFIRMATION'].includes(m.status) && (
            <>
              <button className={btn} onClick={() => run({ op: 'accept', meetingId: m.id })}>Accept</button>
              <button className={btn} onClick={() => run({ op: 'decline', meetingId: m.id })}>Decline</button>
            </>
          )}
          <button className={btn} onClick={() => run({ op: 'cancel', meetingId: m.id })}>Cancel</button>
          <button className={btn} onClick={() => run({ op: 'assign', meetingId: m.id, assigneeId: m.assigneeId === adminId ? null : adminId })}>
            {m.assigneeId === adminId ? 'Unassign me' : 'Assign to me'}
          </button>
          <input aria-label="New time (your local time)" type="datetime-local" className="rounded border px-1 py-0.5 text-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button className={btn} disabled={!when} onClick={() => run({ op: 'reschedule', meetingId: m.id, startsAt: new Date(when).toISOString() })}>Reschedule</button>
        </div>
      )}
      {canWrite && ['CONFIRMED', 'RESCHEDULED'].includes(m.status) && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Manual join link" placeholder="https:// manual join link" className="w-64 rounded border px-2 py-1 text-xs" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className={btn} disabled={!link} onClick={() => run({ op: 'link', meetingId: m.id, url: link })}>Set link</button>
        </div>
      )}
      {canWrite && ['CONFIRMED', 'RESCHEDULED'].includes(m.status) && (
        <div className="space-y-1">
          <textarea aria-label="Outcome" placeholder="Outcome" rows={2} className="w-full rounded border px-2 py-1 text-xs" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <textarea aria-label="Next steps" placeholder="Next steps, one per line" rows={2} className="w-full rounded border px-2 py-1 text-xs" value={steps} onChange={(e) => setSteps(e.target.value)} />
          <button className={btn} onClick={() => run({ op: 'outcome', meetingId: m.id, status: 'COMPLETED', outcome, nextSteps: steps })}>Mark completed</button>{' '}
          <button className={btn} onClick={() => run({ op: 'outcome', meetingId: m.id, status: 'MISSED', outcome })}>Mark missed</button>
        </div>
      )}
      {canNotes && (
        <div className="space-y-1">
          <textarea aria-label="Private notes" placeholder="Private internal notes (never shown to participants)" rows={3} className="w-full rounded border px-2 py-1 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className={btn} onClick={() => run({ op: 'notes', meetingId: m.id, notes })}>Save notes</button>{' '}
          {m.status === 'COMPLETED' && <button className={btn} onClick={() => run({ op: 'summarise', meetingId: m.id })}>AI summary from notes</button>}
        </div>
      )}
    </li>
  );
}

export function AdminMeetingsView(props: {
  meetings: AdminMeeting[];
  canWrite: boolean;
  canNotes: boolean;
  adminId: string;
  providers: ProviderStatus[];
  calendar: { integration: string; reason: string | null; accountLabel: string | null; status: string | null; googleConfigured: boolean; microsoftConfigured: boolean };
  retentionDays: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [retention, setRetention] = useState(props.retentionDays?.toString() ?? '');

  const finish = (r: MeetingOpResult, done = '') => {
    setMessage(r.ok ? { ok: true, text: r.message ?? done } : { ok: false, text: r.error });
    router.refresh();
  };
  const run = (op: MeetingOp) => start(async () => finish(await adminMeetingOpAction(op), 'Done.'));
  const connect = (provider: string) =>
    start(async () => {
      const r = await startPlatformCalendarConnectAction(provider);
      if (r.ok) window.location.href = r.url;
      else setMessage({ ok: false, text: r.error });
    });

  return (
    <div className="space-y-6" aria-busy={pending}>
      {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm' : 'text-sm text-red-700'}>{message.text}</p>}
      <section className="space-y-2 rounded border p-4 text-sm">
        <h2 className="font-medium">Integrations</h2>
        <p>
          Calendar: <strong>{props.calendar.integration}</strong>
          {props.calendar.reason ? ` (${props.calendar.reason})` : ''}
          {props.calendar.accountLabel ? ` · ${props.calendar.accountLabel}` : ''}
          {props.calendar.status ? ` · ${props.calendar.status}` : ''}
        </p>
        <ul className="list-disc pl-5">
          {props.providers.map((p) => (
            <li key={p.kind}>
              {p.kind.replace('_', ' ')}: {p.available ? 'AVAILABLE' : p.reason ?? 'UNAVAILABLE'}
            </li>
          ))}
        </ul>
        {props.canWrite && (
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={!props.calendar.googleConfigured} title={props.calendar.googleConfigured ? '' : 'GOOGLE_CALENDAR_CLIENT_ID/SECRET not set'} onClick={() => connect('google')}>Connect Google Calendar</button>
            <button className={btn} disabled={!props.calendar.microsoftConfigured} title={props.calendar.microsoftConfigured ? '' : 'MICROSOFT_CALENDAR_CLIENT_ID/SECRET not set'} onClick={() => connect('microsoft')}>Connect Outlook</button>
            <button className={btn} onClick={() => start(async () => finish(await platformCalendarOpAction('verify'), 'Calendar verified.'))}>Verify calendar</button>
            <button className={btn} onClick={() => start(async () => finish(await platformCalendarOpAction('disconnect'), 'Calendar disconnected.'))}>Disconnect</button>
            <button className={btn} onClick={() => run({ op: 'verify-zoom' })}>Verify Zoom</button>
            <label className="flex items-center gap-1 text-xs">
              Purge notes after (days)
              <input className="w-16 rounded border px-1 py-0.5" value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="numeric" />
              <button className={btn} onClick={() => run({ op: 'retention', days: retention.trim() ? Number(retention) : null })}>Save</button>
            </label>
          </div>
        )}
      </section>
      {SECTIONS.map((s) => {
        const rows = props.meetings.filter((m) => m.buckets.includes(s.key));
        return (
          <section key={s.key} className="space-y-2">
            <h2 className="font-medium">
              {s.title} <span className="text-sm text-neutral-500">({rows.length})</span>
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm text-neutral-500">Nothing here.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((m) => (
                  <MeetingCard key={`${s.key}:${m.id}`} m={m} canWrite={props.canWrite} canNotes={props.canNotes} adminId={props.adminId} run={run} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

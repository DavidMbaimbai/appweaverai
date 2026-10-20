'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  addFollowUpAction,
  addSlotsAction,
  cancelDraftAction,
  completeFollowUpAction,
  deleteLeadAction,
  deleteSlotAction,
  draftEmailAction,
  exportCsvAction,
  importCsvAction,
  importSubmissionsAction,
  optOutLeadAction,
  qualifyLeadAction,
  sendDraftAction,
  updateLeadAction,
} from '@/lib/actions/project-leads';
import { LEAD_STATUSES } from '@/lib/leads/logic';
import { cancelBookingAction } from '@/lib/actions/calendar';
import type { CalendarStatus } from '@/lib/calendar/service';

import { CalendarPanel } from './calendar-panel';

type LeadView = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  utm: Record<string, string> | null;
  status: string;
  score: number | null;
  scoreReasons: string[];
  suggestedAction: string | null;
  notes: string;
  consent: boolean;
  optedOut: boolean;
  createdAt: string;
  activities: { id: string; type: string; detail: string; createdAt: string }[];
  followUps: { id: string; dueAt: string; note: string }[];
  draft: { id: string; subject: string; body: string } | null;
};
type SlotView = { id: string; startsAt: string; durationMin: number; bookedBy: string | null; bookingId: string | null; bookingStatus: string | null };
type Res = { ok: boolean; error?: string; message?: string };

const card = 'rounded-2xl border border-app-border bg-app-surface p-6';
const field = 'w-full rounded-lg border border-app-border bg-transparent px-3 py-2 text-sm text-app-text';
const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  function run(fn: () => Promise<Res>) {
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? (res.message ?? '') : (res.error ?? 'Something went wrong.'));
      router.refresh();
    });
  }
  return { pending, message, run, setMessage };
}

function LeadCard({ lead }: { lead: LeadView }) {
  const { pending, message, run } = useRunner();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(lead.notes);
  const [subject, setSubject] = useState(lead.draft?.subject ?? '');
  const [body, setBody] = useState(lead.draft?.body ?? '');
  const [due, setDue] = useState('');
  const [dueNote, setDueNote] = useState('');

  return (
    <li className="rounded-xl border border-app-border-subtle p-3 text-sm text-app-text">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="font-medium">{lead.name}</span>
        <span className="text-xs text-app-text-muted">
          {lead.score != null ? `score ${lead.score}` : 'unscored'}
          {lead.optedOut ? ' · opted out' : ''}
        </span>
      </button>
      <div className="text-xs text-app-text-muted">
        {lead.email ?? 'no email'} · {lead.source}
        {lead.utm ? ` · ${Object.values(lead.utm).join(' / ')}` : ''}
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className={field + ' !w-auto'} value={lead.status} disabled={pending} onChange={(e) => run(() => updateLeadAction(lead.id, { status: e.target.value }))}>
              {LEAD_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button className={btn} disabled={pending} onClick={() => run(() => qualifyLeadAction(lead.id))}>
              Qualify with AI
            </button>
            <button className={btn} disabled={pending || !lead.email || lead.optedOut} onClick={() => run(() => draftEmailAction(lead.id))}>
              Draft follow-up
            </button>
          </div>
          {lead.scoreReasons.length ? (
            <ul className="list-disc pl-5 text-xs text-app-text-muted">
              {lead.scoreReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {lead.suggestedAction ? <p className="text-xs">Suggested next action: {lead.suggestedAction}</p> : null}

          {lead.draft ? (
            <div className="space-y-2 rounded-lg border border-app-border p-3">
              <p className="text-xs text-app-text-muted">Draft — nothing is sent until you approve. An unsubscribe footer is added automatically.</p>
              <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
              <textarea className={field} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex gap-2">
                <button className={btn} disabled={pending} onClick={() => run(() => sendDraftAction(lead.draft!.id, subject, body))}>
                  Approve &amp; send
                </button>
                <button className={btn} disabled={pending} onClick={() => run(() => cancelDraftAction(lead.draft!.id))}>
                  Discard
                </button>
              </div>
              {!lead.consent ? <p className="text-xs text-red-500">This lead has not consented to email; sending will be blocked.</p> : null}
            </div>
          ) : null}

          <textarea className={field} rows={3} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={pending} onClick={() => run(() => updateLeadAction(lead.id, { notes }))}>
              Save notes
            </button>
            {!lead.consent && !lead.optedOut ? (
              <button className={btn} disabled={pending} onClick={() => confirm('Only confirm if this person agreed to receive your emails.') && run(() => updateLeadAction(lead.id, { attestConsent: true }))}>
                I have their email consent
              </button>
            ) : (
              <span className="self-center text-xs text-app-text-muted">{lead.consent ? 'Email consent recorded' : ''}</span>
            )}
            {!lead.optedOut ? (
              <button className={btn} disabled={pending} onClick={() => run(() => optOutLeadAction(lead.id))}>
                Do not contact
              </button>
            ) : null}
            <button className={btn} disabled={pending} onClick={() => confirm('Delete this lead?') && run(() => deleteLeadAction(lead.id))}>
              Delete
            </button>
          </div>

          <div className="space-y-1">
            {lead.followUps.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-xs">
                <span>Reminder {f.dueAt.slice(0, 10)} {f.note}</span>
                <button className={btn} disabled={pending} onClick={() => run(() => completeFollowUpAction(f.id))}>
                  Done
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <input type="date" className={field + ' !w-auto'} value={due} onChange={(e) => setDue(e.target.value)} />
              <input className={field + ' !w-auto'} placeholder="Reminder note" value={dueNote} onChange={(e) => setDueNote(e.target.value)} />
              <button className={btn} disabled={pending || !due} onClick={() => run(() => addFollowUpAction(lead.id, new Date(`${due}T09:00:00`).toISOString(), dueNote))}>
                Remind me
              </button>
            </div>
          </div>

          <ul className="space-y-0.5 text-xs text-app-text-muted">
            {lead.activities.map((a) => (
              <li key={a.id}>
                {a.createdAt.slice(0, 10)} · {a.type} {a.detail}
              </li>
            ))}
          </ul>
          {message ? <p className="text-xs text-app-text-muted">{message}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function LeadsDashboard({
  projectId,
  projectName,
  growthHref,
  leads,
  slots,
  calendar,
}: {
  projectId: string;
  projectName: string;
  growthHref: string;
  leads: LeadView[];
  slots: SlotView[];
  calendar: CalendarStatus;
}) {
  const { pending, message, run } = useRunner();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [status, setStatus] = useState('ALL');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('ALL');
  const [slotInput, setSlotInput] = useState('');
  const [duration, setDuration] = useState(30);
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));

  const sources = useMemo(() => [...new Set(leads.map((l) => l.source))], [leads]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (status === 'ALL' || l.status === status) &&
        (source === 'ALL' || l.source === source) &&
        (!q || `${l.name} ${l.email ?? ''} ${l.phone ?? ''} ${l.notes}`.toLowerCase().includes(q)),
    );
  }, [leads, status, query, source]);

  async function download() {
    const res = await exportCsvAction(projectId);
    if (!res.ok) return;
    const url = URL.createObjectURL(new Blob([res.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File | undefined) {
    if (file) run(async () => importCsvAction(projectId, await file.text()));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl text-app-text">Leads — {projectName}</h1>
        <p className="mt-1 text-sm text-app-text-muted">
          Prospects from your widget, forms and demo bookings. Emails go out only after you approve them, only to people who consented.{' '}
          <a className="underline" href={growthHref}>Growth dashboard</a>
        </p>
      </header>

      <section className={card}>
        <h2 className="mb-2 font-display text-lg text-app-text">Capture & import</h2>
        <p className="mb-2 text-xs text-app-text-muted">Embed the lead form on your site:</p>
        <code className="block overflow-x-auto rounded-lg bg-app-border-subtle p-2 text-xs">{`<script src="${origin}/api/projects/${projectId}/leads/widget" async></script>`}</code>
        <p className="mt-2 text-xs text-app-text-muted">
          Demo booking page: <a className="underline" href={`${origin}/book/${projectId}`}>{`${origin}/book/${projectId}`}</a> (your app must be published)
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={btn} disabled={pending} onClick={() => run(() => importSubmissionsAction(projectId))}>Import form submissions</button>
          <label className={btn + ' cursor-pointer'}>
            Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
          </label>
          <button className={btn} onClick={() => void download()}>Export CSV</button>
        </div>
        {message ? <p className="mt-2 text-sm text-app-text-muted">{message}</p> : null}
      </section>

      <section className={card}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-display text-lg text-app-text">Pipeline ({filtered.length})</h2>
          <input className={field + ' !w-48'} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className={field + ' !w-auto'} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>ALL</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className={field + ' !w-auto'} value={source} onChange={(e) => setSource(e.target.value)}>
            <option>ALL</option>
            {sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className={btn} onClick={() => setView(view === 'board' ? 'list' : 'board')}>
            {view === 'board' ? 'List view' : 'Board view'}
          </button>
        </div>
        {!filtered.length ? <p className="text-sm text-app-text-muted">No leads match.</p> : null}
        {view === 'list' ? (
          <ul className="space-y-2">
            {filtered.map((l) => (
              <LeadCard key={l.id} lead={l} />
            ))}
          </ul>
        ) : (
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {LEAD_STATUSES.map((s) => (
              <div key={s}>
                <h3 className="mb-2 text-xs font-semibold text-app-text-muted">
                  {s.replace('_', ' ')} ({filtered.filter((l) => l.status === s).length})
                </h3>
                <ul className="space-y-2">
                  {filtered
                    .filter((l) => l.status === s)
                    .map((l) => (
                      <LeadCard key={l.id} lead={l} />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-display text-lg text-app-text">Demo availability</h2>
        <p className="mb-2 text-xs text-app-text-muted">
          Times shown to visitors in their own time zone.{' '}
          {calendar.integration === 'AVAILABLE'
            ? 'Your calendar is connected: visitors see times from your working hours minus your busy time, and bookings create calendar events.'
            : 'Calendar sync is unavailable: bookings are recorded as pending manual confirmation.'}
        </p>
        <CalendarPanel projectId={projectId} status={calendar} />
        <div className="mb-3 flex flex-wrap gap-2">
          <input type="datetime-local" className={field + ' !w-auto'} value={slotInput} onChange={(e) => setSlotInput(e.target.value)} />
          <select className={field + ' !w-auto'} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
          <button className={btn} disabled={pending || !slotInput} onClick={() => run(async () => { const r = await addSlotsAction(projectId, [new Date(slotInput).toISOString()], duration); return r.ok ? { ok: true, message: 'Slot added.' } : r; })}>
            Add slot
          </button>
        </div>
        <ul className="space-y-1 text-sm text-app-text">
          {slots.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span>{new Date(s.startsAt).toLocaleString()} ({s.durationMin} min)</span>
              <span className="text-xs text-app-text-muted">{s.bookedBy ? `booked by ${s.bookedBy}${s.bookingStatus === 'CONFIRMED' ? ' (calendar confirmed)' : ' (pending manual confirmation)'}` : 'open'}</span>
              {s.bookingId ? (
                <button className={btn} disabled={pending} onClick={() => run(async () => { const r = await cancelBookingAction(projectId, s.bookingId!); return r.ok ? { ok: true, message: r.warning ?? 'Booking cancelled.' } : r; })}>Cancel booking</button>
              ) : null}
              {!s.bookedBy ? (
                <button className={btn} disabled={pending} onClick={() => run(() => deleteSlotAction(s.id))}>Remove</button>
              ) : null}
            </li>
          ))}
          {!slots.length ? <li className="text-xs text-app-text-muted">No upcoming slots.</li> : null}
        </ul>
      </section>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  disconnectCalendarAction,
  saveCalendarSettingsAction,
  startCalendarConnectAction,
  verifyCalendarAction,
} from '@/lib/actions/calendar';
import type { CalendarStatus } from '@/lib/calendar/service';

const field = 'rounded-lg border border-app-border bg-transparent px-3 py-2 text-sm text-app-text';
const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';
const LABELS: Record<string, string> = { GOOGLE: 'Google Calendar', MICROSOFT: 'Microsoft Outlook' };

export function CalendarPanel({ projectId, status }: { projectId: string; status: CalendarStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const conn = status.connection;
  const s = conn?.settings;
  const [tz, setTz] = useState(s?.timeZone ?? 'UTC');
  const [duration, setDuration] = useState(s?.durationMin ?? 30);
  const [before, setBefore] = useState(s?.bufferBeforeMin ?? 0);
  const [after, setAfter] = useState(s?.bufferAfterMin ?? 0);
  const [notice, setNotice] = useState(s?.minNoticeMin ?? 120);
  const [from, setFrom] = useState(s?.workingHours.mon?.[0]?.[0] ?? '09:00');
  const [to, setTo] = useState(s?.workingHours.mon?.[0]?.[1] ?? '17:00');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done = '') {
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? done : (res.error ?? 'Something went wrong.'));
      router.refresh();
    });
  }

  function connect(provider: string) {
    start(async () => {
      const res = await startCalendarConnectAction(projectId, provider);
      if (res.ok) window.location.href = res.url;
      else setMessage(res.error);
    });
  }

  const weekdays = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [[from, to]]]));

  return (
    <div className="mb-4 rounded-xl border border-app-border p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium text-app-text">Calendar sync</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${status.integration === 'AVAILABLE' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
          {status.integration === 'AVAILABLE' ? 'Connected and verified' : 'UNAVAILABLE'}
        </span>
      </div>
      {status.reason ? <p className="mb-2 text-xs text-app-text-muted">{status.reason} Bookings are recorded as pending manual confirmation until then.</p> : null}
      {conn ? (
        <p className="mb-2 text-xs text-app-text-muted">
          {LABELS[conn.provider] ?? conn.provider}
          {conn.accountLabel ? ` · ${conn.accountLabel}` : ''} · {conn.status.replace('_', ' ').toLowerCase()}
          {conn.verifiedAt ? ` · verified ${new Date(conn.verifiedAt).toLocaleString()}` : ''}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2">
        {(['GOOGLE', 'MICROSOFT'] as const).map((p) => (
          <button key={p} className={btn} disabled={pending || !status.providers[p].configured} title={status.providers[p].configured ? '' : 'Not configured on this server'} onClick={() => connect(p)}>
            {conn?.provider === p && conn.status !== 'CONNECTED' ? 'Reconnect' : 'Connect'} {LABELS[p]}
          </button>
        ))}
        {conn ? (
          <>
            <button className={btn} disabled={pending} onClick={() => run(() => verifyCalendarAction(projectId), 'Verified.')}>Verify now</button>
            <button className={btn} disabled={pending} onClick={() => run(() => disconnectCalendarAction(projectId), 'Disconnected and tokens deleted.')}>Disconnect</button>
          </>
        ) : null}
      </div>
      {conn ? (
        <div className="flex flex-wrap items-end gap-2 text-xs text-app-text-muted">
          <label className="grid gap-1">Time zone<input className={field} value={tz} onChange={(e) => setTz(e.target.value)} /></label>
          <label className="grid gap-1">Mon–Fri from<input className={field + ' w-24'} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="grid gap-1">to<input className={field + ' w-24'} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="grid gap-1">Length (min)<input type="number" className={field + ' w-24'} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>
          <label className="grid gap-1">Buffer before<input type="number" className={field + ' w-24'} value={before} onChange={(e) => setBefore(Number(e.target.value))} /></label>
          <label className="grid gap-1">Buffer after<input type="number" className={field + ' w-24'} value={after} onChange={(e) => setAfter(Number(e.target.value))} /></label>
          <label className="grid gap-1">Min notice (min)<input type="number" className={field + ' w-28'} value={notice} onChange={(e) => setNotice(Number(e.target.value))} /></label>
          <button
            className={btn}
            disabled={pending}
            onClick={() =>
              run(
                () => saveCalendarSettingsAction(projectId, { timeZone: tz, workingHours: weekdays, durationMin: duration, bufferBeforeMin: before, bufferAfterMin: after, minNoticeMin: notice }),
                'Settings saved.',
              )
            }
          >
            Save
          </button>
        </div>
      ) : null}
      {message ? <p className="mt-2 text-xs text-app-text">{message}</p> : null}
    </div>
  );
}

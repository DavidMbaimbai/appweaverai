'use client';

import { useCallback, useEffect, useState } from 'react';

type Json = Record<string, unknown>;
type Props = {
  id: string;
  call: (b: Json) => Promise<Json | null>;
  get: (q: string) => Promise<Json | null>;
  busy: boolean;
  setMsg: (m: string | null) => void;
  optedOut: boolean;
  onChange: () => Promise<void>;
};
type Voice = {
  configured: boolean; cap: number; maxTurns: number; maxMinutes: number; disclosure: string;
  hasAiCallConsent: boolean; hasRecordingConsent: boolean; transferConfigured: boolean;
  consents: Array<{ id: string; type: string; evidence: string; obtainedAt: string; revokedAt: string | null }>;
  calls: Array<{ id: string; status: string; outcome: string | null; summary: string | null; createdAt: string; recording: boolean; transferred: boolean; error: string | null }>;
  meetings: Array<{ id: string; note: string; createdAt: string; status: string }>;
};

const input = 'w-full rounded-lg border border-app-border-subtle bg-app-surface p-2 text-sm text-app-text';
const button = 'rounded-lg bg-app-text px-3 py-1.5 text-sm font-medium text-app-bg disabled:opacity-50';
const ghost = 'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';

/** Consent recording, AI call start (with disclosure/cap confirmation) and call log for one investor. */
export function VoicePanel({ id, call, get, busy, setMsg, optedOut, onChange }: Props) {
  const [v, setV] = useState<Voice | null>(null);
  const [evidence, setEvidence] = useState('');
  const [obtainedAt, setObtainedAt] = useState('');
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [transfer, setTransfer] = useState('');

  const load = useCallback(async () => setV((await get(`view=voice&id=${id}`)) as Voice | null), [get, id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const act = async (body: Json, ok: string) => {
    const res = await call({ ...body, id });
    if (res) setMsg(ok);
    await load();
    await onChange();
  };
  if (!v) return null;

  const start = async () => {
    const summary = `${v.disclosure}\n\nLimits: up to ${v.cap} AI calls per day, at most ${v.maxTurns} turns and ${v.maxMinutes} minutes per call, weekdays 09:00-18:00 investor-local time only. The AI answers only from your company profile, transfers to your phone on request${v.transferConfigured || transfer ? '' : ' (no transfer number set: it will say you will follow up)'}, and stops at once if asked.`;
    if (!window.confirm(`Start an AI call? The call opens with this disclosure:\n\n${summary}`)) return;
    await act({ action: 'startAiCall', confirmed: true, transferNumber: transfer || null }, 'AI call started. The result will appear in the call log.');
  };

  return (
    <div className="space-y-3 border-t border-app-border-subtle pt-3">
      <strong>AI voice call</strong>
      <p className="text-xs text-app-text-muted">
        Only available after you record that this investor agreed to an AI call (for example, they replied agreeing to a call). The call starts by saying it is an AI assistant, asks whether now is a good time,
        is not recorded unless recording consent is also recorded, and &quot;don&apos;t call again&quot; adds them to the do-not-contact list immediately.
        {v.configured ? '' : ' Voice is not configured (Twilio keys and a Twilio number are missing), so no calls can be placed.'}
      </p>
      {optedOut ? (
        <p className="text-xs text-red-500">This investor is on the do-not-contact list: no calls.</p>
      ) : (
        <>
          <div className="grid gap-2 tablet-up:grid-cols-2">
            <input className={`${input} tablet-up:col-span-2`} placeholder="How and when did they agree to an AI call? (evidence text, required)" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            <input type="date" className={input} value={obtainedAt} onChange={(e) => setObtainedAt(e.target.value)} />
            <label className="flex items-center gap-2 text-xs text-app-text"><input type="checkbox" checked={recordingConsent} onChange={(e) => setRecordingConsent(e.target.checked)} />This evidence also covers recording the call</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghost} disabled={busy || evidence.trim().length < 10 || !obtainedAt} onClick={async () => {
              const at = new Date(`${obtainedAt}T12:00:00`).toISOString();
              await act({ action: 'recordConsent', type: 'AI_CALL', evidence, obtainedAt: at }, 'AI call consent recorded.');
              if (recordingConsent) await act({ action: 'recordConsent', type: 'CALL_RECORDING', evidence, obtainedAt: at }, 'Recording consent recorded.');
              setEvidence('');
            }}>Record consent</button>
            {v.hasAiCallConsent && <button type="button" className={ghost} disabled={busy} onClick={() => act({ action: 'revokeConsent', type: 'AI_CALL' }, 'AI call consent withdrawn.')}>Withdraw consent</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${input} max-w-xs`} placeholder="Your phone for transfers, e.g. +14155550123" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
            <button type="button" className={button} disabled={busy || !v.configured || !v.hasAiCallConsent} onClick={start}>Start AI call</button>
            {!v.hasAiCallConsent && <span className="text-xs text-app-text-muted">Record consent first.</span>}
          </div>
        </>
      )}
      <ul className="space-y-1 text-xs">
        {v.consents.map((c) => <li key={c.id}><span className="text-app-text-muted">{c.obtainedAt.slice(0, 10)}</span> Consent ({c.type === 'AI_CALL' ? 'AI call' : 'recording'}){c.revokedAt ? ' - withdrawn' : ''}: {c.evidence}</li>)}
        {v.calls.map((c) => <li key={c.id}><span className="text-app-text-muted">{c.createdAt.slice(0, 16).replace('T', ' ')}</span> AI call {c.status.toLowerCase().replace('_', ' ')}{c.outcome ? ` / ${c.outcome.replace(/_/g, ' ').toLowerCase()}` : ''}{c.transferred ? ' / transferred to you' : ''}{c.summary ? ` - ${c.summary}` : ''}{c.error ? ` (${c.error})` : ''}</li>)}
        {v.meetings.map((m) => <li key={m.id}><span className="text-app-text-muted">{m.createdAt.slice(0, 10)}</span> Meeting request ({m.status.toLowerCase()}): {m.note}</li>)}
      </ul>
    </div>
  );
}

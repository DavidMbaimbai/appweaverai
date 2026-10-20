'use client';

import { useCallback, useEffect, useState } from 'react';

import { CampaignsTab } from './investor-campaigns';
import { VoicePanel } from './investor-voice';
import { PIPELINE_STAGES, STAGE_LABELS, INVESTOR_TYPES, OUTREACH_KINDS, type PipelineStage } from '@/lib/investor-hub/constants';

type Json = Record<string, unknown>;
type Investor = {
  id: string; name: string; firm: string | null; type: string; email: string | null; website: string | null;
  linkedinUrl: string | null; focus: string | null; sectors: string[]; stages: string[]; geographies: string[];
  ticketMin: number | null; ticketMax: number | null; portfolio: string[]; sourceUrl: string | null;
  verified: boolean; lastVerifiedAt: string | null; pipelineStage: PipelineStage; score: number | null;
  scoreDetail: { reasons?: string[]; missing?: string[] } | null; brief: string | null;
  briefSources: Array<{ id: number; url: string }> | null; briefAt: string | null; tags: string[];
  optedOut: boolean; sequenceActive: boolean; nextFollowUpAt: string | null; fundingConfirmed: boolean;
};
type Outreach = { id: string; kind: string; variant: number; subject: string | null; body: string; status: string; investorId: string; investor?: { name: string; optedOut: boolean; email: string | null } };
type Activity = { id: string; type: string; summary: string; createdAt: string };

const input = 'w-full rounded-lg border border-app-border-subtle bg-app-surface p-2 text-sm text-app-text';
const button = 'rounded-lg bg-app-text px-3 py-1.5 text-sm font-medium text-app-bg disabled:opacity-50';
const ghost = 'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';
const TABS = ['Profile', 'Discover', 'Pipeline', 'Outreach', 'Replies', 'Campaigns', 'Analytics'] as const;
type Tab = (typeof TABS)[number];

export function InvestorHub({ projectId }: { projectId: string }) {
  const base = `/api/investor-hub/${projectId}`;
  const [tab, setTab] = useState<Tab>('Profile');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (body: Json) => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = (await res.json().catch(() => ({}))) as Json;
        if (!res.ok) setMsg(String(data.error ?? 'Request failed.'));
        return res.ok ? data : null;
      } finally {
        setBusy(false);
      }
    },
    [base],
  );
  const get = useCallback(
    async (query: string) => {
      const res = await fetch(`${base}?${query}`);
      return res.ok ? ((await res.json()) as Json) : null;
    },
    [base],
  );

  const shared = { call, get, base, busy, setMsg };
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap gap-1 border-b border-app-border-subtle">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-app-text font-medium text-app-text' : 'text-app-text-muted'}`}>
            {t}
          </button>
        ))}
      </div>
      {msg && <p role="alert" className="rounded-lg border border-app-border-subtle bg-app-surface p-2 text-sm text-app-text">{msg}</p>}
      {tab === 'Profile' && <ProfileTab {...shared} />}
      {tab === 'Discover' && <DiscoverTab {...shared} onDone={() => setTab('Pipeline')} />}
      {tab === 'Pipeline' && <PipelineTab {...shared} />}
      {tab === 'Outreach' && <OutreachTab {...shared} />}
      {tab === 'Replies' && <RepliesTab {...shared} />}
      {tab === 'Campaigns' && <CampaignsTab call={call} get={get} busy={busy} setMsg={setMsg} />}
      {tab === 'Analytics' && <AnalyticsTab {...shared} />}
    </div>
  );
}

type Shared = {
  call: (b: Json) => Promise<Json | null>;
  get: (q: string) => Promise<Json | null>;
  base: string;
  busy: boolean;
  setMsg: (m: string | null) => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm text-app-text">
      <span className="text-xs text-app-text-muted">{label}</span>
      {children}
    </label>
  );
}

function ProfileTab({ call, get, busy, setMsg }: Shared) {
  const [p, setP] = useState<Record<string, string>>({});
  useEffect(() => {
    void get('view=profile').then((d) => {
      const profile = (d?.profile ?? {}) as Record<string, unknown>;
      setP(Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, v == null ? '' : String(v)])));
    });
  }, [get]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    const amount = p.amountSought?.trim();
    const res = await call({
      action: 'saveProfile',
      profile: {
        companyName: p.companyName ?? '', website: p.website ?? '', description: p.description ?? '', sector: p.sector ?? '',
        stage: p.stage ?? '', amountSought: amount ? Number(amount) : null, currency: p.currency || 'USD',
        geography: p.geography ?? '', traction: p.traction ?? '', useOfFunds: p.useOfFunds ?? '',
      },
    });
    if (res) setMsg('Profile saved. Investor scores were refreshed.');
  };
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-app-text-muted">Only the facts you enter here are used by AI. Nothing is invented.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company name"><input className={input} value={p.companyName ?? ''} onChange={set('companyName')} /></Field>
        <Field label="Website"><input className={input} value={p.website ?? ''} onChange={set('website')} /></Field>
        <Field label="Sector"><input className={input} value={p.sector ?? ''} onChange={set('sector')} placeholder="e.g. fintech" /></Field>
        <Field label="Stage"><input className={input} value={p.stage ?? ''} onChange={set('stage')} placeholder="pre-seed, seed, series a" /></Field>
        <Field label="Amount sought"><input className={input} inputMode="numeric" value={p.amountSought ?? ''} onChange={set('amountSought')} /></Field>
        <Field label="Currency"><input className={input} value={p.currency ?? 'USD'} onChange={set('currency')} /></Field>
        <Field label="Geography"><input className={input} value={p.geography ?? ''} onChange={set('geography')} /></Field>
      </div>
      <Field label="Description"><textarea className={input} rows={3} value={p.description ?? ''} onChange={set('description')} /></Field>
      <Field label="Traction (only real numbers)"><textarea className={input} rows={3} value={p.traction ?? ''} onChange={set('traction')} /></Field>
      <Field label="Use of funds"><textarea className={input} rows={3} value={p.useOfFunds ?? ''} onChange={set('useOfFunds')} /></Field>
      <button type="button" className={button} disabled={busy} onClick={save}>Save profile</button>
    </div>
  );
}

function DiscoverTab({ call, busy, setMsg, onDone }: Shared & { onDone: () => void }) {
  const [c, setC] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setC((s) => ({ ...s, [k]: e.target.value }));
  const [csv, setCsv] = useState('');
  const [manual, setManual] = useState({ name: '', email: '', website: '' });

  const run = async () => {
    const criteria: Json = {};
    for (const k of ['sector', 'geography', 'stage', 'instrument']) if (c[k]) criteria[k] = c[k];
    for (const k of ['ticketMin', 'ticketMax']) if (c[k]) criteria[k] = Number(c[k]);
    setMsg('Searching public pages. This can take a minute...');
    const res = await call({ action: 'discover', criteria });
    const s = res?.summary as { pages: number; added: number; duplicates: number; errors: string[] } | undefined;
    if (s) {
      setMsg(`Read ${s.pages} public pages: ${s.added} new, ${s.duplicates} already known. All results are unverified until you check the source link.${s.errors.length ? ` Issues: ${s.errors[0]}` : ''}`);
      if (s.added) onDone();
    }
  };
  const importCsv = async () => {
    const res = await call({ action: 'importCsv', csv });
    if (res) setMsg(`Imported ${String(res.created)} new, skipped ${String(res.duplicates)} duplicates.`);
  };
  const add = async () => {
    const res = await call({ action: 'addInvestor', investor: { name: manual.name, email: manual.email || null, website: manual.website || null } });
    if (res) setMsg('Investor added.');
  };

  return (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-3">
        <h2 className="font-medium text-app-text">Find investors, grants and accelerators</h2>
        <p className="text-sm text-app-text-muted">Leave a field blank to use your company profile. Results come from public web pages, stored with their source link and flagged unverified.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sector"><input className={input} onChange={set('sector')} /></Field>
          <Field label="Geography"><input className={input} onChange={set('geography')} /></Field>
          <Field label="Stage"><input className={input} onChange={set('stage')} /></Field>
          <Field label="Instrument">
            <select className={input} onChange={set('instrument')} defaultValue="">
              <option value="">Any</option><option value="equity">Equity</option><option value="debt">Debt</option><option value="grant">Grant</option>
            </select>
          </Field>
          <Field label="Min ticket"><input className={input} inputMode="numeric" onChange={set('ticketMin')} /></Field>
          <Field label="Max ticket"><input className={input} inputMode="numeric" onChange={set('ticketMax')} /></Field>
        </div>
        <button type="button" className={button} disabled={busy} onClick={run}>{busy ? 'Working...' : 'Discover'}</button>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium text-app-text">Add one manually</h2>
        <div className="grid grid-cols-3 gap-2">
          <input className={input} placeholder="Name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
          <input className={input} placeholder="Email (optional)" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
          <input className={input} placeholder="Website (optional)" value={manual.website} onChange={(e) => setManual({ ...manual, website: e.target.value })} />
        </div>
        <button type="button" className={ghost} disabled={busy || !manual.name} onClick={add}>Add</button>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium text-app-text">Import CSV</h2>
        <p className="text-xs text-app-text-muted">Header row with: name, firm, email, website, type, tags, linkedin. Duplicates (same domain or email) are skipped.</p>
        <textarea className={input} rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        <div><button type="button" className={ghost} disabled={busy || !csv} onClick={importCsv}>Import</button></div>
      </section>
    </div>
  );
}

function PipelineTab({ call, get, base, busy, setMsg }: Shared) {
  const [rows, setRows] = useState<Investor[]>([]);
  const [f, setF] = useState({ q: '', stage: '', type: '', tag: '', due: false });
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ view: 'investors' });
    if (f.q) qs.set('q', f.q);
    if (f.stage) qs.set('stage', f.stage);
    if (f.type) qs.set('type', f.type);
    if (f.tag) qs.set('tag', f.tag);
    if (f.due) qs.set('due', '1');
    const d = await get(qs.toString());
    setRows((d?.investors as Investor[]) ?? []);
  }, [get, f]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} max-w-56`} placeholder="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className={`${input} max-w-44`} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
          <option value="">All stages</option>
          {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select className={`${input} max-w-40`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">All types</option>
          {INVESTOR_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <input className={`${input} max-w-32`} placeholder="Tag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} />
        <label className="flex items-center gap-1 text-sm text-app-text"><input type="checkbox" checked={f.due} onChange={(e) => setF({ ...f, due: e.target.checked })} /> Follow-up due</label>
        <a className={ghost} href={`${base}?view=export`}>Export CSV</a>
      </div>
      <div className="overflow-x-auto rounded-xl border border-app-border-subtle">
        <table className="w-full text-left text-sm text-app-text">
          <thead className="text-xs text-app-text-muted"><tr><th className="p-2">Name</th><th>Type</th><th>Stage</th><th>Fit</th><th>Data</th><th>Follow-up</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-app-border-subtle hover:bg-app-surface-hover" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td className="p-2">{r.name}{r.firm ? <span className="text-app-text-muted"> · {r.firm}</span> : null}{r.optedOut ? ' (opted out)' : ''}</td>
                <td>{r.type.replace('_', ' ')}</td>
                <td>{STAGE_LABELS[r.pipelineStage]}</td>
                <td>{r.score ?? 'n/a'}</td>
                <td>{r.verified ? 'Verified' : 'Unverified'}</td>
                <td>{r.nextFollowUpAt ? r.nextFollowUpAt.slice(0, 10) : ''}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="p-4 text-app-text-muted" colSpan={6}>No investors yet. Use Discover or import a CSV.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <InvestorDetail id={open} call={call} get={get} busy={busy} setMsg={setMsg} base={base} onChange={load} />}
    </div>
  );
}

function InvestorDetail({ id, call, get, busy, setMsg, onChange }: Shared & { id: string; onChange: () => void }) {
  const [d, setD] = useState<{ investor: Investor; activities: Activity[]; outreach: Outreach[] } | null>(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [follow, setFollow] = useState('');
  const load = useCallback(async () => {
    const res = (await get(`view=investor&id=${id}`)) as typeof d;
    setD(res);
    if (res) setTags(res.investor.tags.join(', '));
  }, [get, id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  if (!d) return <p className="text-sm text-app-text-muted">Loading...</p>;
  const inv = d.investor;
  const act = async (body: Json, ok?: string) => {
    const res = await call({ ...body, id });
    if (res && ok) setMsg(ok);
    await load();
    onChange();
  };
  const detail = inv.scoreDetail ?? {};

  return (
    <div className="space-y-3 rounded-xl border border-app-border-subtle bg-app-surface p-4 text-sm text-app-text">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{inv.name}</strong>
        <div className="flex flex-wrap gap-2">
          <select className={`${input} w-44`} value={inv.pipelineStage} onChange={(e) => {
            const stage = e.target.value;
            const confirm = stage === 'FUNDING_SECURED' ? window.confirm('Confirm that this investor has actually committed funding?') : false;
            if (stage === 'FUNDING_SECURED' && !confirm) return;
            void act({ action: 'updateInvestor', stage, confirmFunding: confirm });
          }}>
            {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          <button type="button" className={ghost} disabled={busy} onClick={() => act({ action: 'research' }, 'Brief updated.')}>{inv.brief ? 'Refresh brief' : 'Research'}</button>
          <button type="button" className={ghost} disabled={busy} onClick={() => act({ action: 'updateInvestor', verified: !inv.verified })}>Mark {inv.verified ? 'unverified' : 'verified'}</button>
          <button type="button" className={ghost} disabled={busy} onClick={() => window.confirm('Delete this investor?') && act({ action: 'deleteInvestor' }).then(() => setD(null))}>Delete</button>
        </div>
      </div>
      <p className="text-xs text-app-text-muted">
        {inv.verified ? 'Verified' : 'Unverified'}
        {inv.lastVerifiedAt ? ` · last checked ${inv.lastVerifiedAt.slice(0, 10)}` : ''}
        {inv.sourceUrl ? <> · source: <a className="underline" href={inv.sourceUrl} target="_blank" rel="noreferrer noopener">{inv.sourceUrl}</a></> : ' · user-provided'}
      </p>
      <p>{[inv.email, inv.website, inv.focus].filter(Boolean).join(' · ') || 'No contact data.'}</p>
      <p className="text-xs text-app-text-muted">
        {inv.sectors.length ? `Sectors: ${inv.sectors.join(', ')}. ` : ''}{inv.stages.length ? `Stages: ${inv.stages.join(', ')}. ` : ''}
        {inv.ticketMin != null || inv.ticketMax != null ? `Ticket: ${inv.ticketMin ?? '?'}-${inv.ticketMax ?? '?'}. ` : ''}{inv.portfolio.length ? `Portfolio: ${inv.portfolio.join(', ')}.` : ''}
      </p>
      <div>
        <strong>Fit score: {inv.score ?? 'not enough data'}</strong>
        <ul className="list-disc pl-5 text-xs">{(detail.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
        {!!detail.missing?.length && <ul className="list-disc pl-5 text-xs text-app-text-muted">{detail.missing.map((r) => <li key={r}>Missing: {r}</li>)}</ul>}
      </div>
      {inv.brief && (
        <div>
          <strong>Research brief</strong> <span className="text-xs text-app-text-muted">{inv.briefAt?.slice(0, 10)}</span>
          <p className="whitespace-pre-wrap text-xs">{inv.brief}</p>
          <ul className="text-xs">{(inv.briefSources ?? []).map((s) => <li key={s.id}>[{s.id}] <a className="underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a></li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${input} max-w-xs`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" />
        <button type="button" className={ghost} onClick={() => act({ action: 'updateInvestor', tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })}>Save tags</button>
        <input type="date" className={`${input} max-w-44`} value={follow || (inv.nextFollowUpAt?.slice(0, 10) ?? '')} onChange={(e) => setFollow(e.target.value)} />
        <button type="button" className={ghost} onClick={() => act({ action: 'updateInvestor', nextFollowUpAt: follow ? new Date(`${follow}T09:00:00`).toISOString() : null })}>Set reminder</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {OUTREACH_KINDS.map((k) => (
          <button key={k} type="button" className={ghost} disabled={busy || inv.optedOut} onClick={() => act({ action: 'generate', kind: k }, 'Drafts created. Review and approve them in the Outreach tab.')}>Draft {k.toLowerCase().replace('_', ' ')}</button>
        ))}
        {inv.sequenceActive && <button type="button" className={ghost} onClick={() => act({ action: 'stopSequence' })}>Stop follow-ups</button>}
      </div>
      <CommsPanel id={id} call={call} get={get} busy={busy} setMsg={setMsg} base="" optedOut={inv.optedOut} onChange={async () => { await load(); onChange(); }} />
      <VoicePanel id={id} call={call} get={get} busy={busy} setMsg={setMsg} optedOut={inv.optedOut} onChange={async () => { await load(); onChange(); }} />
      <div className="flex gap-2">
        <input className={input} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className={ghost} disabled={!note} onClick={async () => { await act({ action: 'addNote', note }); setNote(''); }}>Add</button>
      </div>
      <ul className="space-y-1 text-xs">
        {d.activities.map((a) => <li key={a.id}><span className="text-app-text-muted">{a.createdAt.slice(0, 16).replace('T', ' ')}</span> {a.summary}</li>)}
      </ul>
    </div>
  );
}

const CALL_OUTCOME_LABELS: Record<string, string> = {
  CONNECTED: 'Spoke with them', VOICEMAIL: 'Left voicemail', NO_ANSWER: 'No answer', WRONG_NUMBER: 'Wrong number',
  NOT_INTERESTED: 'Not interested', MEETING_BOOKED: 'Meeting booked', FOLLOW_UP_LATER: 'Follow up later', DO_NOT_CALL: 'Asked not to be contacted',
};
type CommsData = {
  contact: { phone: string | null; timezone: string | null; smsConsent: boolean; smsConsentAt: string | null; smsConsentNote: string | null; smsOptedOut: boolean } | null;
  calls: Array<{ id: string; calledAt: string; outcome: string; notes: string | null; nextStep: string | null }>;
  sms: Array<{ id: string; body: string; status: string; createdAt: string; error: string | null }>;
  dryRun: boolean;
};

function CommsPanel({ id, call, get, busy, setMsg, optedOut, onChange }: Shared & { id: string; optedOut: boolean; onChange: () => Promise<void> }) {
  const [c, setC] = useState<CommsData | null>(null);
  const [phone, setPhone] = useState('');
  const [zone, setZone] = useState('');
  const [consentNote, setConsentNote] = useState('');
  const [sms, setSms] = useState('');
  const [callAt, setCallAt] = useState('');
  const [outcome, setOutcome] = useState('CONNECTED');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [nextDate, setNextDate] = useState('');

  const load = useCallback(async () => {
    const res = (await get(`view=comms&id=${id}`)) as CommsData | null;
    setC(res);
    if (res?.contact) {
      setPhone(res.contact.phone ?? '');
      setZone(res.contact.timezone ?? '');
      setConsentNote(res.contact.smsConsentNote ?? '');
    }
  }, [get, id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const act = async (body: Json, ok?: string) => {
    const res = await call({ ...body, id });
    if (res && ok) setMsg(ok);
    await load();
    await onChange();
  };
  if (!c) return null;
  const consent = Boolean(c.contact?.smsConsent);

  return (
    <div className="space-y-3 border-t border-app-border-subtle pt-3">
      <strong>Calls and texts</strong>
      <p className="text-xs text-app-text-muted">
        Calls are never dialled by the app: call yourself, then log what happened. Texts go through Twilio only, only with consent you record below, only
        08:00-20:00 in the investor&apos;s time zone, and a STOP reply opts them out of everything.
        {c.dryRun ? ' Twilio is not configured, so texts are logged as a dry run and not delivered.' : ''}
      </p>
      <div className="grid gap-2 tablet-up:grid-cols-2">
        <input className={input} placeholder="Phone, e.g. +14155550123" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className={input} placeholder="Time zone, e.g. America/New_York" value={zone} onChange={(e) => setZone(e.target.value)} />
        <input className={`${input} tablet-up:col-span-2`} placeholder="How and when did they agree to texts? (required for consent)" value={consentNote} onChange={(e) => setConsentNote(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghost} disabled={busy} onClick={() => act({ action: 'saveContact', phone: phone || null, timezone: zone || null }, 'Contact details saved.')}>Save phone and zone</button>
        {c.contact?.smsOptedOut ? (
          <span className="text-xs text-red-500">Replied STOP: no texts, ever.</span>
        ) : consent ? (
          <button type="button" className={ghost} disabled={busy} onClick={() => act({ action: 'saveContact', smsConsent: false }, 'Consent withdrawn.')}>Withdraw SMS consent</button>
        ) : (
          <button type="button" className={ghost} disabled={busy || !consentNote.trim() || !phone} onClick={() => act({ action: 'saveContact', phone, timezone: zone || null, smsConsent: true, consentNote }, 'Consent recorded.')}>Record SMS consent</button>
        )}
        {!optedOut && <button type="button" className={ghost} disabled={busy} onClick={() => window.confirm('Mark this investor do-not-contact (email, SMS and calls)?') && act({ action: 'optOut' }, 'Marked do-not-contact.')}>Do not contact</button>}
      </div>
      {consent && !optedOut && (
        <div className="flex gap-2">
          <input className={input} maxLength={500} placeholder="Text message (STOP footer is added)" value={sms} onChange={(e) => setSms(e.target.value)} />
          <button type="button" className={button} disabled={busy || !sms.trim()} onClick={async () => { await act({ action: 'sendSms', body: sms }, c.dryRun ? 'Dry run logged (Twilio not configured).' : 'Text sent.'); setSms(''); }}>Send text</button>
        </div>
      )}
      <div className="grid gap-2 tablet-up:grid-cols-2">
        <input type="datetime-local" className={input} value={callAt} onChange={(e) => setCallAt(e.target.value)} />
        <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {Object.entries(CALL_OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className={input} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <input className={input} placeholder="Next step" value={next} onChange={(e) => setNext(e.target.value)} />
        <input type="date" className={input} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
        <button
          type="button"
          className={button}
          disabled={busy || !callAt}
          onClick={async () => {
            await act({
              action: 'logCall',
              calledAt: new Date(callAt).toISOString(),
              outcome,
              notes: notes || null,
              nextStep: next || null,
              nextFollowUpAt: nextDate ? new Date(`${nextDate}T09:00:00`).toISOString() : null,
            }, 'Call logged.');
            setNotes(''); setNext(''); setNextDate('');
          }}>
          Log call
        </button>
      </div>
      <ul className="space-y-1 text-xs">
        {c.calls.map((x) => <li key={x.id}><span className="text-app-text-muted">{x.calledAt.slice(0, 16).replace('T', ' ')}</span> Call: {CALL_OUTCOME_LABELS[x.outcome] ?? x.outcome}{x.notes ? ` - ${x.notes}` : ''}{x.nextStep ? ` (next: ${x.nextStep})` : ''}</li>)}
        {c.sms.map((x) => <li key={x.id}><span className="text-app-text-muted">{x.createdAt.slice(0, 16).replace('T', ' ')}</span> SMS {x.status.toLowerCase().replace('_', ' ')}: {x.body}</li>)}
      </ul>
    </div>
  );
}

function OutreachCard({ item, run, busy }: { item: Outreach; run: (b: Json, ok?: string) => Promise<void>; busy: boolean }) {
  const [subject, setSubject] = useState(item.subject ?? '');
  const [body, setBody] = useState(item.body);
  const dirty = body !== item.body || (item.subject ?? '') !== subject;
  const locked = item.status === 'SENT' || item.status === 'CANCELLED';
  return (
    <div className="space-y-2 rounded-xl border border-app-border-subtle bg-app-surface p-4 text-sm text-app-text">
      <div className="flex justify-between"><strong>{item.investor?.name} · {item.kind.replace('_', ' ')} #{item.variant}</strong><span className="text-xs text-app-text-muted">{item.status}</span></div>
      {item.kind !== 'LINKEDIN' && item.kind !== 'CALL_SCRIPT' && <input className={input} disabled={locked} value={subject} onChange={(e) => setSubject(e.target.value)} />}
      <textarea className={input} rows={7} disabled={locked} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {dirty && !locked && <button type="button" className={ghost} disabled={busy} onClick={() => run({ action: 'editOutreach', outreachId: item.id, subject: subject || null, body })}>Save edits</button>}
        {item.status === 'DRAFT' && !dirty && <button type="button" className={button} disabled={busy} onClick={() => run({ action: 'approve', outreachId: item.id })}>Approve</button>}
        {item.status === 'APPROVED' && (
          <>
            <button type="button" className={ghost} onClick={() => navigator.clipboard.writeText(item.subject ? `Subject: ${item.subject}\n\n${item.body}` : item.body)}>Copy</button>
            {item.investor?.email && item.kind !== 'LINKEDIN' && item.kind !== 'CALL_SCRIPT' && (
              <a className={ghost} href={`mailto:${item.investor.email}?subject=${encodeURIComponent(item.subject ?? '')}&body=${encodeURIComponent(item.body)}`}>Open in my email app</a>
            )}
            <button type="button" className={button} disabled={busy} onClick={() => run({ action: 'markSent', outreachId: item.id }, 'Logged as sent.')}>I sent it</button>
          </>
        )}
        {!locked && <button type="button" className={ghost} disabled={busy} onClick={() => run({ action: 'cancelOutreach', outreachId: item.id })}>Discard</button>}
      </div>
      {item.status === 'APPROVED' && <p className="text-xs text-app-text-muted">No sender is connected, so copy this and send it yourself, then confirm.</p>}
    </div>
  );
}

function OutreachTab({ call, get, busy, setMsg }: Shared) {
  const [items, setItems] = useState<Outreach[]>([]);
  const load = useCallback(async () => setItems(((await get('view=outreach'))?.outreach as Outreach[]) ?? []), [get]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const run = async (body: Json, ok?: string) => {
    const res = await call(body);
    if (res && ok) setMsg(ok);
    await load();
  };
  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-sm text-app-text-muted">Nothing is ever sent automatically. Drafts need your approval, opted-out contacts are blocked, and a daily limit applies. Create drafts from an investor in the Pipeline tab.</p>
      {items.map((i) => <OutreachCard key={`${i.id}:${i.body.length}:${i.status}`} item={i} run={run} busy={busy} />)}
      {!items.length && <p className="text-sm text-app-text-muted">No outreach yet.</p>}
    </div>
  );
}

function RepliesTab({ call, get, busy, setMsg }: Shared) {
  const [replies, setReplies] = useState<Array<{ id: string; text: string; classification: string; createdAt: string; investor: { name: string } }>>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const load = useCallback(async () => {
    setReplies(((await get('view=replies'))?.replies as typeof replies) ?? []);
    setInvestors(((await get('view=investors'))?.investors as Investor[]) ?? []);
  }, [get]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const submit = async () => {
    const res = await call({ action: 'recordReply', id: target, text });
    if (res) {
      setMsg(`Classified as "${String(res.classification).replace('_', ' ')}". CRM updated${(res.effect as { optOut?: boolean })?.optOut ? '; contact opted out and pending drafts cancelled' : ''}.`);
      setText('');
      await load();
    }
  };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-app-text-muted">Paste a reply you received. It is classified, the CRM is updated, follow-ups stop, and unsubscribe requests apply immediately.</p>
        <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select investor</option>
          {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <textarea className={input} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className={button} disabled={busy || !target || !text} onClick={submit}>Classify and update</button>
      </div>
      <ul className="space-y-2 text-sm text-app-text">
        {replies.map((r) => (
          <li key={r.id} className="rounded-lg border border-app-border-subtle p-3">
            <strong>{r.investor.name}</strong> · {r.classification.replace('_', ' ')} <span className="text-xs text-app-text-muted">{r.createdAt.slice(0, 10)}</span>
            <p className="whitespace-pre-wrap text-xs text-app-text-muted">{r.text.slice(0, 400)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalyticsTab({ get, base }: Shared) {
  const [a, setA] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { void get('view=analytics').then((d) => setA((d?.analytics as Record<string, unknown>) ?? null)); }, [get]);
  const rows: Array<[string, string]> = [
    ['Discovered', 'discovered'], ['Qualified', 'qualified'], ['Contacted', 'contacted'], ['Emails/messages sent (logged by you)', 'sent'],
    ['Replied', 'replied'], ['Meetings', 'meetings'], ['Deck requests', 'deckRequests'], ['Funding secured (confirmed by you)', 'fundingSecured'],
  ];
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-app-text-muted">Counts of what actually happened in this project. No projections.</p>
      <div className="grid grid-cols-2 gap-3">
        {rows.map(([label, key]) => (
          <div key={key} className="rounded-xl border border-app-border-subtle bg-app-surface p-3">
            <div className="text-2xl text-app-text">{a ? String(a[key] ?? 0) : '-'}</div>
            <div className="text-xs text-app-text-muted">{label}</div>
          </div>
        ))}
      </div>
      <a className={ghost} href={`${base}?view=export&kind=analytics`}>Export analytics CSV</a>
    </div>
  );
}

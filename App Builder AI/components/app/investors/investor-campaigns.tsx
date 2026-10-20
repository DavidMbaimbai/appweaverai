'use client';

import { useCallback, useEffect, useState } from 'react';

type Json = Record<string, unknown>;
type Props = {
  call: (b: Json) => Promise<Json | null>;
  get: (q: string) => Promise<Json | null>;
  busy: boolean;
  setMsg: (m: string | null) => void;
};
type Campaign = {
  id: string; name: string; status: string; templateSubject: string; templateBody: string; followUpBody: string;
  dailyLimit: number; sendWindowStart: number; sendWindowEnd: number; timezone: string; followUpDays: number[];
  pausedReason: string | null; approvedAt: string | null;
  stats: { targets: number; sent: number; bounced: number; replied: number; active: number };
};
type Preview = {
  targetCount: number; unrenderable: string[]; emailConfigured: boolean; sender: string;
  samples: Array<{ to: string; subject: string; text: string }>;
  followUpSample: { subject: string; body: string } | null;
};
type Investor = { id: string; name: string; email: string | null };

const input = 'w-full rounded-lg border border-app-border-subtle bg-app-surface p-2 text-sm text-app-text';
const button = 'rounded-lg bg-app-text px-3 py-1.5 text-sm font-medium text-app-bg disabled:opacity-50';
const ghost = 'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';

/** Per-campaign approval: review the sampled emails once, tick the acknowledgement, then the cron sends automatically. */
export function CampaignsTab({ call, get, busy, setMsg }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [limit, setLimit] = useState(20);
  const [zone, setZone] = useState('UTC');
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(17);
  const [preview, setPreview] = useState<{ id: string; data: Preview } | null>(null);
  const [ack, setAck] = useState(false);

  const load = useCallback(async () => {
    const res = (await get('view=campaigns')) as { campaigns: Campaign[]; emailConfigured: boolean } | null;
    if (res) { setCampaigns(res.campaigns); setEmailConfigured(res.emailConfigured); }
    const inv = (await get('view=investors')) as { investors: Investor[] } | null;
    if (inv) setInvestors(inv.investors.filter((i) => i.email));
  }, [get]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const act = async (b: Json, ok: string) => {
    const res = await call(b);
    if (res) setMsg(ok);
    await load();
    return res;
  };
  const review = async (id: string) => {
    setAck(false);
    const data = (await get(`view=campaign&id=${id}`)) as Preview | null;
    if (data) setPreview({ id, data });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-app-text-muted">
        You approve a campaign once instead of every email. Emails then go out automatically, only to investors with a publicly listed business email and source URL, within the daily limit and send window,
        always with your identity, postal address and a one-click unsubscribe. Anyone who replies, bounces or opts out is removed from the sequence automatically. Replies are never answered automatically.
        {emailConfigured ? '' : ' Email is not fully configured (SMTP, postal address, OUTREACH_SECRET): nothing is sent until it is.'}
      </p>

      <div className="space-y-2 rounded-lg border border-app-border-subtle p-3">
        <strong className="text-sm">New campaign</strong>
        <input className={input} placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={input} placeholder="Subject, e.g. Quick intro: {{company}}" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className={`${input} min-h-32`} placeholder="Body. Merge fields: {{firstName}}, {{firm}}, {{company}}. No brackets or invented facts." value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="button" className={ghost} disabled={busy} onClick={async () => {
          const res = (await call({ action: 'generateCampaignTemplate' })) as { subject?: string; body?: string } | null;
          if (res?.subject && res.body) { setSubject(res.subject); setBody(res.body); }
        }}>Draft from my company profile</button>
        <div className="grid gap-2 tablet-up:grid-cols-4">
          <label className="text-xs text-app-text-muted">Daily limit (max 50)<input type="number" min={1} max={50} className={input} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
          <label className="text-xs text-app-text-muted">Time zone<input className={input} value={zone} onChange={(e) => setZone(e.target.value)} /></label>
          <label className="text-xs text-app-text-muted">Window start (hour)<input type="number" min={0} max={23} className={input} value={start} onChange={(e) => setStart(Number(e.target.value))} /></label>
          <label className="text-xs text-app-text-muted">Window end (hour)<input type="number" min={1} max={24} className={input} value={end} onChange={(e) => setEnd(Number(e.target.value))} /></label>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-app-text-muted">Targets ({picked.length} selected; only public business emails with a source are accepted)</summary>
          <div className="mt-2 max-h-48 space-y-1 overflow-auto">
            {investors.map((i) => (
              <label key={i.id} className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id))} />{i.name} ({i.email})</label>
            ))}
          </div>
        </details>
        <button type="button" className={button} disabled={busy || !name.trim() || !subject.trim() || !body.trim() || !picked.length} onClick={async () => {
          const res = (await act({
            action: 'createCampaign', investorIds: picked,
            campaign: { name, templateSubject: subject, templateBody: body, settings: { dailyLimit: limit, timezone: zone, sendWindowStart: start, sendWindowEnd: end } },
          }, 'Campaign saved as a draft. Review the preview, then approve.')) as { skipped?: Array<{ name: string; reason: string }> } | null;
          if (res?.skipped?.length) setMsg(`Saved. Skipped: ${res.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`);
        }}>Save draft</button>
      </div>

      {campaigns.map((c) => (
        <div key={c.id} className="space-y-2 rounded-lg border border-app-border-subtle p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{c.name} <span className="text-xs font-normal text-app-text-muted">{c.status}</span></strong>
            <span className="text-xs text-app-text-muted">{c.stats.targets} targets, {c.stats.sent} sent, {c.stats.replied} replied, {c.stats.bounced} bounced, {c.stats.active} active</span>
          </div>
          {c.pausedReason && <p className="text-xs text-red-500">{c.pausedReason}</p>}
          <p className="text-xs text-app-text-muted">Up to {c.dailyLimit}/day, weekdays {c.sendWindowStart}:00-{c.sendWindowEnd}:00 {c.timezone}, follow-ups after {c.followUpDays.join(' and ') || 'none'} days.</p>
          <div className="flex flex-wrap gap-2">
            {c.status === 'DRAFT' && <button type="button" className={ghost} disabled={busy} onClick={() => review(c.id)}>Review and approve</button>}
            {(c.status === 'APPROVED' || c.status === 'RUNNING') && <button type="button" className={button} disabled={busy} onClick={() => act({ action: 'pauseCampaign', campaignId: c.id }, 'Paused. No further emails will be sent.')}>Pause now</button>}
            {c.status === 'PAUSED' && c.approvedAt && <button type="button" className={ghost} disabled={busy} onClick={() => act({ action: 'resumeCampaign', campaignId: c.id }, 'Resumed.')}>Resume</button>}
            {!['STOPPED', 'DONE'].includes(c.status) && <button type="button" className={ghost} disabled={busy} onClick={() => window.confirm('Stop this campaign for good?') && act({ action: 'stopCampaign', campaignId: c.id }, 'Campaign stopped.')}>Stop</button>}
          </div>
          {preview?.id === c.id && (
            <div className="space-y-2 border-t border-app-border-subtle pt-2">
              <p className="text-xs text-app-text-muted">{preview.data.targetCount} targets. Sender: {preview.data.sender}. Three sampled emails exactly as they will be sent:</p>
              {preview.data.samples.map((s) => (
                <pre key={s.to} className="whitespace-pre-wrap rounded-lg bg-app-surface p-2 text-xs"><strong>To: {s.to}{'\n'}Subject: {s.subject}</strong>{'\n\n'}{s.text}</pre>
              ))}
              {preview.data.followUpSample && <pre className="whitespace-pre-wrap rounded-lg bg-app-surface p-2 text-xs"><strong>Follow-up: {preview.data.followUpSample.subject}</strong>{'\n\n'}{preview.data.followUpSample.body}</pre>}
              {preview.data.unrenderable.length > 0 && <p className="text-xs text-red-500">Will be skipped (missing merge field): {preview.data.unrenderable.join(', ')}</p>}
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I am the sender of these messages and confirm they comply with applicable anti-spam and privacy law.</label>
              <button type="button" className={button} disabled={busy || !ack} onClick={async () => { await act({ action: 'approveCampaign', campaignId: c.id, acknowledged: true }, 'Approved. Sending starts automatically within the window.'); setPreview(null); }}>Approve campaign</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

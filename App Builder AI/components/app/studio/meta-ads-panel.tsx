'use client';

import { useMemo, useState, useTransition } from 'react';

import {
  disconnectMetaAdsAction,
  launchCustomerAdAction,
  pauseCustomerAdAction,
  selectMetaAssetsAction,
  setDailyCapAction,
} from '@/lib/actions/meta-ads';

export type MetaAdsPanelProps = {
  configured: boolean;
  connection: {
    adAccountName: string | null;
    pageName: string | null;
    currency: string | null;
    dailyCapCents: number;
    ready: boolean;
  } | null;
  assets: {
    adAccounts: { id: string; name: string; currency: string }[];
    pages: { id: string; name: string }[];
  } | null;
  ads: {
    id: string;
    headline: string;
    primaryText: string;
    status: string;
    startsAt: string;
    endsAt: string;
    dailyCents: number;
    spendCents: number;
    clicks: number;
    impressions: number;
  }[];
  notice?: string;
};

const input = 'w-full rounded-lg border border-app-border-subtle bg-app-surface p-2 text-sm text-app-text';
const button = 'rounded-lg bg-app-text px-4 py-2 text-sm font-medium text-app-bg disabled:opacity-50';

function timeZones() {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const zones = fn ? fn('timeZone') : [];
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

export function MetaAdsPanel({ configured, connection, assets, ads, notice }: MetaAdsPanelProps) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(notice ?? null);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(assets?.adAccounts[0]?.id ?? '');
  const [pageId, setPageId] = useState(assets?.pages[0]?.id ?? '');
  const [cap, setCap] = useState(String((connection?.dailyCapCents ?? 500) / 100));

  const [brief, setBrief] = useState('');
  const [link, setLink] = useState('https://');
  const [budget, setBudget] = useState('5');
  const [days, setDays] = useState('7');
  const [startLocal, setStartLocal] = useState('');
  const defaultZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [timeZone, setTimeZone] = useState(defaultZone);
  const zones = useMemo(() => timeZones(), []);
  const [ack, setAck] = useState(false);

  function run(task: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await task();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else if (result.message) setMessage(result.message);
    });
  }

  if (!configured) {
    return <p className="text-sm text-app-text-muted">Running ads from your own Facebook account is not enabled yet.</p>;
  }

  const currency = connection?.currency ?? '';

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-app-text">Run ads on Facebook and Instagram</h2>
      {message ? <p className="text-sm text-green-600">{message}</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {!connection ? (
        <>
          <p className="text-sm text-app-text-muted">
            Connect your Facebook account. Ads run in your own ad account and Meta bills you directly.
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route redirect, not a page */}
          <a href="/api/meta-ads/connect" className={`${button} inline-block`}>
            Connect Facebook
          </a>
        </>
      ) : null}

      {connection && !connection.ready && assets ? (
        <div className="space-y-3">
          <label className="block text-sm text-app-text">
            Ad account
            <select className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {assets.adAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-app-text">
            Facebook page
            <select className={input} value={pageId} onChange={(e) => setPageId(e.target.value)}>
              {assets.pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {assets.adAccounts.length === 0 || assets.pages.length === 0 ? (
            <p className="text-sm text-red-500">No active ad account or page found on this Facebook login.</p>
          ) : null}
          <button
            type="button"
            className={button}
            disabled={pending || !accountId || !pageId}
            onClick={() => run(() => selectMetaAssetsAction(accountId, pageId))}>
            Use these
          </button>
        </div>
      ) : null}

      {connection?.ready ? (
        <div className="space-y-4">
          <p className="text-sm text-app-text-secondary">
            Connected: {connection.adAccountName} · {connection.pageName}.{' '}
            <button type="button" className="underline" onClick={() => run(disconnectMetaAdsAction)}>
              Disconnect and stop all ads
            </button>
          </p>

          <div className="flex items-end gap-2">
            <label className="block text-sm text-app-text">
              Daily spending cap across all ads ({currency})
              <input className={input} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" />
            </label>
            <button
              type="button"
              className={button}
              disabled={pending}
              onClick={() => run(() => setDailyCapAction(Math.round(Number(cap) * 100)))}>
              Save cap
            </button>
          </div>

          <label className="block text-sm text-app-text">
            What are you promoting?
            <textarea className={input} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Same-day plumbing repairs in Leeds. Fixed call-out fee, 24/7." />
          </label>
          <label className="block text-sm text-app-text">
            Website link
            <input className={input} value={link} onChange={(e) => setLink(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-app-text">
              Daily budget ({currency})
              <input className={input} value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" />
            </label>
            <label className="block text-sm text-app-text">
              Run for (days, up to 14)
              <input className={input} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
            </label>
            <label className="block text-sm text-app-text">
              Start at (leave empty to start now)
              <input type="datetime-local" className={input} value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
            </label>
            <label className="block text-sm text-app-text">
              Time zone
              <select className={input} value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm text-app-text">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            I understand Meta will charge my ad account up to the budget I set.
          </label>
          <button
            type="button"
            className={button}
            disabled={pending || !ack}
            onClick={() =>
              run(() =>
                launchCustomerAdAction({
                  brief,
                  link,
                  dailyBudgetCents: Math.round(Number(budget) * 100),
                  days: Number(days),
                  startLocal: startLocal || undefined,
                  timeZone,
                  acknowledge: ack,
                }),
              )
            }>
            {pending ? 'Working…' : startLocal ? 'Schedule ad' : 'Launch ad'}
          </button>
        </div>
      ) : null}

      {ads.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-app-text">Your ads</h3>
          {ads.map((ad) => (
            <div key={ad.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-3 text-sm">
              <p className="font-medium text-app-text">{ad.headline} · {ad.status}</p>
              <p className="text-app-text-secondary">{ad.primaryText}</p>
              <p className="text-xs text-app-text-muted">
                {new Date(ad.startsAt).toLocaleString()} to {new Date(ad.endsAt).toLocaleString()} ·{' '}
                {(ad.dailyCents / 100).toFixed(2)}/day · {ad.impressions} views · {ad.clicks} clicks
              </p>
              {ad.status === 'ACTIVE' || ad.status === 'SCHEDULED' ? (
                <button type="button" className="mt-1 text-xs underline" disabled={pending}
                  onClick={() => run(() => pauseCustomerAdAction(ad.id))}>
                  Pause
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

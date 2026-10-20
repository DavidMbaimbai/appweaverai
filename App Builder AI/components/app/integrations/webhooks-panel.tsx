'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  createInboundEndpointAction,
  createSubscriptionAction,
  deleteInboundEndpointAction,
  deleteSubscriptionAction,
  getWebhookPanelAction,
  sendTestWebhookAction,
} from '@/lib/actions/integrations';

type PanelData = Exclude<Awaited<ReturnType<typeof getWebhookPanelAction>>, { error: string }>;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://appweaverai.com').replace(/\/$/, '');

export function WebhooksPanel({ projectId, kind, isOwner }: { projectId: string; kind: 'webhooks_inbound' | 'webhooks_outbound'; isOwner: boolean }) {
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<{ label: string; secret: string } | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('*');
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const res = await getWebhookPanelAction(projectId);
    if ('error' in res) setError(res.error ?? '');
    else setData(res);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    getWebhookPanelAction(projectId).then((res) => {
      if (cancelled) return;
      if ('error' in res) setError(res.error ?? '');
      else setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function run(fn: () => Promise<{ error?: string; secret?: string } | undefined>, label?: string) {
    start(async () => {
      setError('');
      const res = await fn();
      if (res?.error) setError(res.error);
      else if (res?.secret && label) setRevealed({ label, secret: res.secret });
      await load();
    });
  }

  const inbound = kind === 'webhooks_inbound';

  return (
    <section className="mt-5 space-y-3 text-sm">
      {revealed ? (
        <div className="rounded-lg border border-yellow-600/40 bg-yellow-600/10 p-3">
          <p className="font-medium text-yellow-300">Signing secret for {revealed.label}. It is shown only once.</p>
          <code className="mt-1 block break-all text-xs">{revealed.secret}</code>
          <button type="button" className="mt-2 text-xs text-app-accent-blue hover:underline" onClick={() => setRevealed(null)}>
            I have saved it
          </button>
        </div>
      ) : null}
      {error ? <p className="text-red-300">{error}</p> : null}

      {inbound ? (
        <>
          <p className="text-app-text-secondary">
            Senders POST JSON with headers <code>X-Webhook-Id</code> (unique id; repeats are ignored), <code>X-Webhook-Timestamp</code> (unix
            seconds, within 5 minutes) and <code>X-Webhook-Signature: v1=hex(HMAC-SHA256(secret, timestamp + &quot;.&quot; + body))</code>.
          </p>
          {data?.endpoints?.map((e) => (
            <div key={e.id} className="rounded-lg border border-app-border-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{e.name}</span>
                {isOwner ? (
                  <button type="button" disabled={pending} className="text-xs text-red-300 hover:underline" onClick={() => run(async () => deleteInboundEndpointAction(projectId, e.id).then((r) => ('error' in r ? r : undefined)))}>
                    Delete
                  </button>
                ) : null}
              </div>
              <code className="block break-all text-xs text-app-text-secondary">{`${APP_URL}/api/webhooks/inbound/${e.publicId}`}</code>
              <span className="text-xs text-app-text-muted">{e.eventCount} events received</span>
            </div>
          ))}
          {isOwner ? (
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Endpoint name" className="flex-1 rounded-lg border border-app-border-subtle bg-app-bg px-3 py-1.5" />
              <button
                type="button"
                disabled={pending}
                className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await createInboundEndpointAction(projectId, name);
                    setName('');
                    return 'error' in res ? { error: res.error } : { secret: res.secret };
                  }, name || 'new endpoint')
                }
              >
                Create endpoint
              </button>
            </div>
          ) : null}
          <h4 className="pt-2 font-medium">Recent events</h4>
          {data?.events?.length ? (
            <ul className="space-y-1 text-xs text-app-text-secondary">
              {data.events?.map((ev) => (
                <li key={ev.id}>
                  {new Date(ev.receivedAt).toLocaleString()} · {ev.endpoint} · <code>{ev.eventId}</code> · {ev.preview.slice(0, 80)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-app-text-muted">No events yet.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-app-text-secondary">
            We POST signed JSON to your https URL with <code>X-Webhook-Id</code>, <code>X-Webhook-Timestamp</code> and <code>X-Webhook-Signature</code>. Failed
            deliveries are retried up to 6 times with backoff (1 min → 12 h).
          </p>
          {data?.subscriptions?.map((s) => (
            <div key={s.id} className="rounded-lg border border-app-border-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="break-all text-xs">{s.url}</code>
                {isOwner ? (
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button type="button" disabled={pending} className="text-app-accent-blue hover:underline" onClick={() => run(async () => sendTestWebhookAction(projectId, s.id).then((r) => ('error' in r ? r : undefined)))}>
                      Send test
                    </button>
                    <button type="button" disabled={pending} className="text-red-300 hover:underline" onClick={() => run(async () => deleteSubscriptionAction(projectId, s.id).then((r) => ('error' in r ? r : undefined)))}>
                      Delete
                    </button>
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-app-text-muted">
                {s.events.join(', ')} · {s.active ? 'active' : 'disabled after repeated failures'}
              </span>
            </div>
          ))}
          {isOwner ? (
            <div className="space-y-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks" className="w-full rounded-lg border border-app-border-subtle bg-app-bg px-3 py-1.5" />
              <input value={events} onChange={(e) => setEvents(e.target.value)} placeholder="Events, comma separated (or *)" className="w-full rounded-lg border border-app-border-subtle bg-app-bg px-3 py-1.5" />
              <button
                type="button"
                disabled={pending}
                className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const res = await createSubscriptionAction(projectId, url, events.split(','));
                    if (!('error' in res)) setUrl('');
                    return 'error' in res ? { error: res.error } : { secret: res.secret };
                  }, url)
                }
              >
                Add subscription
              </button>
            </div>
          ) : null}
          <h4 className="pt-2 font-medium">Delivery log</h4>
          {data?.deliveries?.length ? (
            <ul className="space-y-1 text-xs text-app-text-secondary">
              {data.deliveries?.map((d) => (
                <li key={d.id}>
                  {new Date(d.createdAt).toLocaleString()} · {d.event} → {d.host} · {d.status.toLowerCase()} · attempts {d.attempts}
                  {d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ''}
                  {d.lastError ? ` · ${d.lastError}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-app-text-muted">No deliveries yet.</p>
          )}
        </>
      )}
    </section>
  );
}

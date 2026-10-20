'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { InboxOp, InboxOpResult } from '@/lib/messaging/ops';
import { CHANNEL_LABELS, CONVERSATION_STATUSES, MESSAGE_CHANNELS, SESSION_WINDOW_MS, WINDOWED_CHANNELS } from '@/lib/messaging/types';
import type { MessageChannelName } from '@/lib/messaging/types';

export type InboxThread = {
  id: string;
  channel: MessageChannelName;
  contactName: string | null;
  contactRef: string;
  status: string;
  humanTakeover: boolean;
  isReview: boolean;
  category: string | null;
  summary: string | null;
  language: string | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  preview: string | null;
};

export type InboxMessageView = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  createdAt: string;
  isDraft: boolean;
  aiGenerated: boolean;
  deliveryStatus: string | null;
  category: string | null;
  sources: Array<{ id: string; title: string }>;
  error: string | null;
};

export type ChannelStatusView = {
  channel: MessageChannelName;
  configured: boolean;
  missing: string[];
  note?: string;
  availability?: 'AVAILABLE' | 'UNAVAILABLE';
  availabilityReason?: string;
};

type Props = {
  baseHref: string;
  threads: InboxThread[];
  selected: { thread: InboxThread; messages: InboxMessageView[] } | null;
  filters: { status?: string; channel?: string; q?: string };
  statuses: ChannelStatusView[];
  canWrite: boolean;
  onOp: (input: InboxOp) => Promise<InboxOpResult>;
  onVerify?: (channel: MessageChannelName) => Promise<InboxOpResult>;
};

const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';
const field = 'rounded-lg border border-app-border bg-transparent px-2 py-1.5 text-sm text-app-text';

function windowOpen(thread: InboxThread) {
  if (!WINDOWED_CHANNELS.includes(thread.channel)) return true;
  return Boolean(thread.lastInboundAt) && Date.now() - new Date(thread.lastInboundAt as string).getTime() < SESSION_WINDOW_MS;
}

export function ChannelStatusPanel({
  statuses,
  onVerify,
}: {
  statuses: ChannelStatusView[];
  onVerify?: (channel: MessageChannelName) => Promise<InboxOpResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  return (
    <section className="space-y-2 rounded-xl border border-app-border-subtle p-3">
      <h2 className="text-sm font-semibold text-app-text">Channels</h2>
      <ul className="space-y-1.5 text-sm">
        {statuses.map((s) => (
          <li key={s.channel}>
            <span className="font-medium text-app-text">{CHANNEL_LABELS[s.channel]}</span>{' '}
            <span className={s.configured ? 'text-emerald-600' : 'text-app-text-muted'}>{s.configured ? 'connected' : 'not configured'}</span>
            {s.availability ? (
              <span className={s.availability === 'AVAILABLE' ? ' text-emerald-600' : ' text-amber-600'}> · {s.availability.toLowerCase()}</span>
            ) : null}
            {s.missing.length ? <p className="break-words text-xs text-app-text-muted">Missing: {s.missing.join(', ')}</p> : null}
            {s.availability === 'UNAVAILABLE' && s.availabilityReason ? <p className="text-xs text-app-text-muted">{s.availabilityReason}</p> : null}
            {s.note ? <p className="text-xs text-app-text-muted">{s.note}</p> : null}
            {onVerify && s.availability && s.configured ? (
              <button
                className="mt-1 rounded-lg border border-app-border px-2 py-0.5 text-xs text-app-text hover:bg-app-border-subtle disabled:opacity-50"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await onVerify(s.channel);
                    setMessage(r.ok ? (r.message ?? 'Verified.') : r.error);
                    router.refresh();
                  })
                }>
                Verify now
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? <p className="text-xs text-app-text-muted">{message}</p> : null}
    </section>
  );
}

function ThreadView({ selected, canWrite, onOp }: { selected: NonNullable<Props['selected']>; canWrite: boolean; onOp: Props['onOp'] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const { thread, messages } = selected;
  const draft = [...messages].reverse().find((m) => m.isDraft) ?? null;
  const [text, setText] = useState(draft?.body ?? '');
  const [template, setTemplate] = useState('');
  const open = windowOpen(thread);

  const run = (input: InboxOp, after?: () => void) =>
    start(async () => {
      const result = await onOp(input);
      setError(result.ok ? '' : result.error);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-app-text">{thread.contactName || thread.contactRef}</h2>
          <span className="text-xs text-app-text-muted">
            {CHANNEL_LABELS[thread.channel]} · {thread.status}
            {thread.language ? ` · ${thread.language}` : ''}
            {thread.category ? ` · ${thread.category}` : ''}
          </span>
          {thread.isReview ? <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-600">review: never auto-answered</span> : null}
          {thread.humanTakeover ? <span className="rounded bg-blue-500/15 px-1.5 text-xs text-blue-600">human takeover: AI paused</span> : null}
        </div>
        {thread.summary ? <p className="text-sm text-app-text-secondary">{thread.summary}</p> : null}
        {!open ? (
          <p className="text-xs text-amber-600">
            The 24h reply window has closed.{' '}
            {thread.channel === 'WHATSAPP' ? 'Only an approved template can be sent.' : 'This channel cannot be messaged until the contact writes again.'}
          </p>
        ) : null}
      </header>

      <ol className="max-h-[420px] space-y-2 overflow-auto rounded-xl border border-app-border-subtle p-3">
        {messages.filter((m) => !m.isDraft).map((m) => (
          <li key={m.id} className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${m.direction === 'INBOUND' ? 'bg-app-border-subtle text-app-text' : 'ml-auto bg-blue-500/10 text-app-text'}`}>
            {m.body}
            <div className="mt-1 text-[11px] text-app-text-muted">
              {new Date(m.createdAt).toLocaleString()}
              {m.direction === 'OUTBOUND' ? ` · ${m.aiGenerated ? 'AI' : 'team'}${m.deliveryStatus ? ` · ${m.deliveryStatus.toLowerCase()}` : ''}` : ''}
              {m.error ? ` · ${m.error}` : ''}
            </div>
          </li>
        ))}
      </ol>

      {draft ? (
        <div className="space-y-1 rounded-xl border border-dashed border-app-border p-3 text-sm">
          <strong className="text-app-text">{draft.aiGenerated ? 'AI draft' : 'Draft'}</strong>
          {draft.category ? <span className="text-app-text-muted"> · {draft.category}</span> : null}
          {draft.sources.length ? (
            <p className="text-xs text-app-text-muted">Sources: {draft.sources.map((s) => s.title).join('; ')}</p>
          ) : (
            <p className="text-xs text-amber-600">No verified source: check this carefully before sending.</p>
          )}
        </div>
      ) : null}

      {canWrite ? (
        <div className="space-y-2">
          {open ? (
            <textarea className={`${field} min-h-24 w-full`} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Write a reply" />
          ) : thread.channel === 'WHATSAPP' ? (
            <input className={`${field} w-full`} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Approved template name" />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {open || thread.channel === 'WHATSAPP' ? (
              <button
                className={btn}
                disabled={pending || (open ? !text.trim() : !template.trim())}
                onClick={() =>
                  run(
                    open
                      ? { op: 'send', conversationId: thread.id, body: text, draftId: draft?.id }
                      : { op: 'send', conversationId: thread.id, body: '', templateName: template.trim() },
                    () => setText(''),
                  )
                }>
                {draft && open ? 'Approve & send' : 'Send'}
              </button>
            ) : null}
            {draft ? (
              <button className={btn} disabled={pending} onClick={() => run({ op: 'discard', conversationId: thread.id, draftId: draft.id }, () => setText(''))}>
                Discard draft
              </button>
            ) : null}
            <button className={btn} disabled={pending} onClick={() => run({ op: 'takeover', conversationId: thread.id, on: !thread.humanTakeover })}>
              {thread.humanTakeover ? 'Hand back to AI' : 'Take over'}
            </button>
            {thread.status !== 'ESCALATED' ? (
              <button className={btn} disabled={pending} onClick={() => run({ op: 'escalate', conversationId: thread.id })}>Escalate</button>
            ) : null}
            {thread.status !== 'RESOLVED' ? (
              <button className={btn} disabled={pending} onClick={() => run({ op: 'resolve', conversationId: thread.id })}>Resolve</button>
            ) : (
              <button className={btn} disabled={pending} onClick={() => run({ op: 'reopen', conversationId: thread.id })}>Reopen</button>
            )}
          </div>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-app-text-muted">You have read-only access to this inbox.</p>
      )}
    </section>
  );
}

export function InboxView({ baseHref, threads, selected, filters, statuses, canWrite, onOp, onVerify }: Props) {
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const next = { ...filters, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3">
        <form action={baseHref} className="flex gap-2">
          {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
          {filters.channel ? <input type="hidden" name="channel" value={filters.channel} /> : null}
          <input name="q" defaultValue={filters.q ?? ''} placeholder="Search contact or summary" className={`${field} min-w-0 flex-1`} />
          <button className={btn} type="submit">Search</button>
        </form>
        <div className="flex flex-wrap gap-1 text-xs">
          <Link className={btn} href={href({ status: undefined })}>All</Link>
          {CONVERSATION_STATUSES.map((s) => (
            <Link key={s} className={`${btn} ${filters.status === s ? 'bg-app-border-subtle' : ''}`} href={href({ status: s })}>{s.toLowerCase()}</Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {MESSAGE_CHANNELS.map((c) => (
            <Link key={c} className={`${btn} ${filters.channel === c ? 'bg-app-border-subtle' : ''}`} href={href({ channel: filters.channel === c ? undefined : c })}>{CHANNEL_LABELS[c]}</Link>
          ))}
        </div>
        <ul className="space-y-1">
          {threads.length === 0 ? <li className="text-sm text-app-text-muted">No conversations yet.</li> : null}
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={href({ c: t.id } as Record<string, string>)}
                className={`block rounded-lg border p-2 text-sm ${selected?.thread.id === t.id ? 'border-blue-500' : 'border-app-border-subtle'} hover:bg-app-border-subtle`}>
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-app-text">{t.contactName || t.contactRef}</strong>
                  <span className="shrink-0 text-[11px] text-app-text-muted">{new Date(t.lastMessageAt).toLocaleDateString()}</span>
                </div>
                <div className="text-xs text-app-text-muted">{CHANNEL_LABELS[t.channel]} · {t.status.toLowerCase()}{t.humanTakeover ? ' · human' : ''}</div>
                {t.preview ? <p className="truncate text-xs text-app-text-secondary">{t.preview}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
        <ChannelStatusPanel statuses={statuses} onVerify={canWrite ? onVerify : undefined} />
      </aside>
      <main>
        {selected ? <ThreadView key={`${selected.thread.id}:${selected.messages.at(-1)?.id ?? ''}`} selected={selected} canWrite={canWrite} onOp={onOp} /> : <p className="text-sm text-app-text-muted">Select a conversation.</p>}
      </main>
    </div>
  );
}

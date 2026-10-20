'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  approvePostAction,
  deletePostAction,
  disconnectSocialAction,
  generateCampaignAction,
  markPostedManuallyAction,
  savePostAction,
  selectFacebookPageAction,
  unapprovePostAction,
} from '@/lib/actions/project-marketing';
import {
  composePostText,
  MAX_TEXT,
  PLATFORM_LABELS,
  type Platform,
} from '@/lib/project-marketing/constants';

export type PostView = {
  id: string;
  campaignId: string;
  campaignName: string;
  platform: Platform;
  text: string;
  hashtags: string[];
  imageUrl: string | null;
  status: string;
  error: string | null;
  timeZone: string;
  scheduledAt: string | null;
  localTime: string;
  publishedAt: string | null;
};

type Props = {
  projectId: string;
  projectPath: string;
  siteUrl: string | null;
  notice?: string;
  connections: { platform: 'X' | 'LINKEDIN' | 'FACEBOOK'; configured: boolean; connected: boolean; accountName: string | null; expired: boolean }[];
  pageChoices: { id: string; name: string }[];
  instagramViaFacebook: boolean;
  calendar: { date: string; items: PostView[] }[];
  campaigns: { id: string; name: string; status: string; createdAt: string; posts: PostView[] }[];
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
};

type ActionResult = { ok: boolean; error?: string; message?: string };

const input = 'w-full rounded-lg border border-app-border-subtle bg-app-surface p-2 text-sm text-app-text';
const button = 'rounded-lg bg-app-text px-3 py-1.5 text-sm font-medium text-app-bg disabled:opacity-50';
const ghost = 'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';

function zones() {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn('timeZone') : [];
  return list.includes('UTC') ? list : ['UTC', ...list];
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function PostCard({ post, run, pending }: { post: PostView; run: (t: () => Promise<ActionResult>) => void; pending: boolean }) {
  const [text, setText] = useState(post.text);
  const [tags, setTags] = useState(post.hashtags.map((t) => `#${t}`).join(' '));
  const [image, setImage] = useState(post.imageUrl ?? '');
  const [local, setLocal] = useState(post.localTime);
  const [zone, setZone] = useState(post.timeZone);
  const zoneList = useMemo(() => zones(), []);
  const locked = post.status === 'PUBLISHED' || post.status === 'PUBLISHING';
  const limit = MAX_TEXT[post.platform];
  const composed = composePostText(text, tags.split(/[\s,]+/).filter(Boolean).map((t) => t.replace(/^#+/, '')));
  const approved = ['APPROVED', 'SCHEDULED', 'MANUAL'].includes(post.status);

  return (
    <div className="space-y-2 rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <div className="flex items-center justify-between text-sm">
        <strong className="text-app-text">{PLATFORM_LABELS[post.platform]}</strong>
        <span className="text-xs text-app-text-muted">{post.status}</span>
      </div>
      <textarea className={input} rows={post.platform === 'TIKTOK' ? 7 : 4} value={text} disabled={locked} onChange={(e) => setText(e.target.value)} />
      <div className="flex justify-between text-xs text-app-text-muted">
        <span className={composed.length > limit ? 'text-red-500' : ''}>{composed.length}/{limit}</span>
        {post.platform === 'TIKTOK' ? <span>Script and caption: export only, not posted automatically.</span> : null}
      </div>
      <input className={input} placeholder="#hashtags" value={tags} disabled={locked} onChange={(e) => setTags(e.target.value)} />
      <input className={input} placeholder={post.platform === 'INSTAGRAM' ? 'Image URL (https, required to auto-post)' : 'Image URL (https, optional)'} value={image} disabled={locked} onChange={(e) => setImage(e.target.value)} />
      <div className="grid gap-2 tablet-up:grid-cols-2">
        <input type="datetime-local" className={input} value={local} disabled={locked} onChange={(e) => setLocal(e.target.value)} />
        <input className={input} list="pm-zones" value={zone} disabled={locked} onChange={(e) => setZone(e.target.value)} />
        <datalist id="pm-zones">{zoneList.map((z) => <option key={z} value={z} />)}</datalist>
      </div>
      {post.error ? <p className="text-xs text-red-500">{post.error}</p> : null}
      {!locked ? (
        <div className="flex flex-wrap gap-2">
          <button className={ghost} disabled={pending} onClick={() => run(() => savePostAction(post.id, { text, hashtags: tags, imageUrl: image }))}>
            Save draft
          </button>
          {approved ? (
            <button className={ghost} disabled={pending} onClick={() => run(() => unapprovePostAction(post.id))}>
              Withdraw approval
            </button>
          ) : (
            <button
              className={button}
              disabled={pending || !local}
              onClick={() =>
                run(async () => {
                  // Approval applies to the text on screen, so save it first.
                  const saved = await savePostAction(post.id, { text, hashtags: tags, imageUrl: image });
                  return saved.ok ? approvePostAction(post.id, local, zone) : saved;
                })
              }>
              Approve &amp; schedule
            </button>
          )}
          <button className={ghost} onClick={() => void navigator.clipboard.writeText(composed)}>Copy</button>
          {post.status === 'MANUAL' ? (
            <button className={ghost} disabled={pending} onClick={() => run(() => markPostedManuallyAction(post.id))}>
              I posted this
            </button>
          ) : null}
          <button className={ghost} disabled={pending} onClick={() => run(() => deletePostAction(post.id))}>Delete</button>
        </div>
      ) : null}
    </div>
  );
}

export function MarketingWorkspace({ projectId, projectPath, siteUrl, notice, connections, pageChoices, instagramViaFacebook, calendar, campaigns, byStatus, byPlatform }: Props) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(notice ?? null);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  function run(task: () => Promise<ActionResult>) {
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await task();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else {
        setMessage(result.message ?? 'Done.');
        router.refresh();
      }
    });
  }

  const exportCampaign = (c: Props['campaigns'][number]) =>
    download(
      `${c.name.replace(/[^\w-]+/g, '-')}.txt`,
      c.posts
        .map((p) => `== ${PLATFORM_LABELS[p.platform]} (${p.localTime || 'unscheduled'} ${p.timeZone}) ==\n${composePostText(p.text, p.hashtags)}`)
        .join('\n\n'),
    );

  return (
    <div className="mx-auto w-full max-w-app-content flex-1 space-y-10 px-4 py-6 tablet-up:px-8">
      <p className="text-sm text-app-text-muted">
        AI drafts posts from your project. Nothing is published until you approve and schedule it, and posts go only to accounts you connect.
        {siteUrl ? null : ' Publish your project first so posts can link to it.'}
      </p>
      {message ? <p className="text-sm text-green-600">{message}</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-app-text">Connected accounts</h2>
        <ul className="space-y-2">
          {connections.map((c) => (
            <li key={c.platform} className="flex items-center justify-between rounded-xl border border-app-border-subtle bg-app-surface p-3 text-sm">
              <span className="text-app-text">
                {PLATFORM_LABELS[c.platform]}
                {c.connected ? ` · ${c.accountName ?? 'connected'}${c.expired ? ' (expired, reconnect)' : ''}` : ''}
              </span>
              {!c.configured ? (
                <span className="text-xs text-app-text-muted">Not configured</span>
              ) : (
                <span className="flex gap-2">
                  <a className={ghost} href={`/api/project-marketing/connect/${c.platform.toLowerCase()}?project=${projectPath}`}>
                    {c.connected ? 'Reconnect' : 'Connect'}
                  </a>
                  {c.connected ? (
                    <button className={ghost} disabled={pending} onClick={() => run(() => disconnectSocialAction(c.platform))}>Disconnect</button>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
        {pageChoices.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-app-border-subtle bg-app-surface p-3 text-sm">
            <p className="text-app-text">Your account manages several Facebook Pages. Which one should posts go to?</p>
            <div className="flex flex-wrap gap-2">
              {pageChoices.map((p) => (
                <button key={p.id} className={button} disabled={pending} onClick={() => run(() => selectFacebookPageAction(p.id))}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-app-text-muted">
          Instagram posts use the Instagram Business account linked to your connected Facebook Page
          {instagramViaFacebook ? '' : ' (connect Facebook first)'} and need an https image URL; without one they stay manual. Meta requires the
          instagram_basic and instagram_content_publish permissions (app review) and reconnecting Facebook after they are approved. TikTok is
          copy/export only; mark it posted yourself. To switch Pages, press Reconnect on Facebook.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-app-text">Generate a campaign</h2>
        <textarea className={input} rows={3} maxLength={1500} placeholder="Optional: goal, offer or audience. Only facts you write here are used." value={brief} onChange={(e) => setBrief(e.target.value)} />
        <button className={button} disabled={pending} onClick={() => run(() => generateCampaignAction(projectId, brief, zone))}>
          {pending ? 'Working…' : 'Generate posts'}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-app-text">Analytics</h2>
        <p className="text-sm text-app-text-muted">
          Post counts only; reach and engagement are not tracked here.
        </p>
        <div className="grid gap-2 text-sm text-app-text tablet-up:grid-cols-2">
          <div>{Object.entries(byStatus).map(([k, v]) => <div key={k}>{k}: {v}</div>)}{Object.keys(byStatus).length ? null : 'No posts yet.'}</div>
          <div>{Object.entries(byPlatform).map(([k, v]) => <div key={k}>{PLATFORM_LABELS[k as Platform] ?? k}: {v}</div>)}</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-app-text">Content calendar</h2>
        {calendar.length === 0 ? <p className="text-sm text-app-text-muted">Nothing scheduled yet.</p> : null}
        {calendar.map((group) => (
          <div key={group.date}>
            <h3 className="mb-1 text-xs font-medium uppercase text-app-text-muted">{group.date}</h3>
            <ul className="space-y-1">
              {group.items.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 rounded-lg border border-app-border-subtle px-3 py-2 text-sm">
                  <span className="truncate text-app-text">
                    {p.localTime.slice(11)} {p.timeZone} · {PLATFORM_LABELS[p.platform]} · {p.text.slice(0, 70)}
                  </span>
                  <span className="shrink-0 text-xs text-app-text-muted">{p.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-app-text">Campaigns and drafts</h2>
        {campaigns.length === 0 ? <p className="text-sm text-app-text-muted">No campaigns yet.</p> : null}
        {campaigns.map((c, index) => (
          <details key={c.id} open={index === 0} className="rounded-xl border border-app-border-subtle p-4">
            <summary className="cursor-pointer text-sm text-app-text">
              {c.name}
              <span className="ml-2 text-xs text-app-text-muted">{c.status} · {new Date(c.createdAt).toLocaleDateString('en-GB')}</span>
            </summary>
            <div className="mt-3 space-y-3">
              <button className={ghost} onClick={() => exportCampaign(c)}>Export all as text</button>
              {c.posts.map((p) => <PostCard key={p.id} post={p} run={run} pending={pending} />)}
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-app-text">Paid ads</h2>
        <p className="text-sm text-app-text-muted">
          Paid Facebook and Instagram ads are managed in Studio, where you set the budget and approve every launch. Nothing here spends money.
        </p>
        <Link href="/app/studio" className={`${ghost} inline-block`}>Open Studio ads</Link>
      </section>
    </div>
  );
}

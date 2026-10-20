'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  addKnowledgeAction,
  analyzeIssueAction,
  approveIssueAction,
  createIssueFromReviewAction,
  deleteKnowledgeAction,
  deleteAllReviewDataAction,
  resolveTicketAction,
  saveReviewSettingsAction,
  sendReviewReplyAction,
  setReviewStatusAction,
  verifyIssueAction,
} from '@/lib/actions/project-reviews';
import type { ReviewStats } from '@/lib/project-reviews/stats';

type Settings = {
  enabled: boolean;
  autoReplyPositive: boolean;
  businessInfo: string;
  tone: 'friendly' | 'professional' | 'casual';
  notifyEmail: string;
  statusWebhookUrl: string;
};

type Review = {
  id: string;
  rating: number;
  authorName: string;
  authorEmail: string | null;
  body: string;
  topic: string | null;
  sentiment: string | null;
  urgency: string | null;
  status: string;
  aiDraft: string | null;
  reply: string | null;
  replyStatus: string;
  createdAt: string;
  responseState: string;
  evidenceText: string | null;
  stateReasons: string[];
  approvedAt: string | null;
  hasIssue: boolean;
};

type Issue = {
  id: string;
  title: string;
  severity: string;
  status: string;
  analysis: string | null;
  proposedPlan: string | null;
  fixPrompt: string;
  verifiedAt: string | null;
};

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  settings: Settings;
  stats: ReviewStats;
  reviews: Review[];
  issues: Issue[];
  knowledge: Array<{ id: string; title: string; content: string }>;
  tickets: Array<{ id: string; question: string; contact: string | null; createdAt: string }>;
};

const STATE_LABELS: Record<string, string> = {
  READY_FOR_REVIEW: 'Ready for your review',
  NEEDS_INVESTIGATION: 'Needs investigation — no evidence found',
  ESCALATION_REQUIRED: 'Escalation required',
  APPROVED_FOR_AUTOMATION: 'Eligible for auto-reply',
};

const card = 'rounded-2xl border border-app-border bg-app-surface p-6';
const field =
  'w-full rounded-lg border border-app-border bg-transparent px-3 py-2 text-sm text-app-text';
const btn =
  'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';

function ReviewRow({ review }: { review: Review }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(review.reply ?? review.aiDraft ?? '');
  const [error, setError] = useState('');
  const sent = review.replyStatus === 'SENT';

  function run(fn: () => Promise<{ error?: string } | { ok: boolean }>) {
    start(async () => {
      const res = await fn();
      setError('error' in res && res.error ? res.error : '');
      router.refresh();
    });
  }

  return (
    <li className="space-y-2 rounded-xl border border-app-border-subtle p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-amber-500">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
        <strong className="text-app-text">{review.authorName}</strong>
        {review.sentiment ? <span className="text-app-text-muted">{review.sentiment}</span> : null}
        {review.topic ? <span className="text-app-text-muted">· {review.topic}</span> : null}
        {review.urgency === 'high' ? <span className="font-medium text-red-500">urgent</span> : null}
        {review.status === 'HIDDEN' ? <span className="text-app-text-muted">(hidden)</span> : null}
        <span className="ml-auto text-xs text-app-text-muted">
          {new Date(review.createdAt).toLocaleDateString()}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-app-text">{review.body}</p>
      {review.authorEmail ? <p className="text-xs text-app-text-muted">{review.authorEmail}</p> : null}

      {review.replyStatus !== 'SENT' && review.aiDraft ? (
        <p className="text-xs text-app-text-muted">
          Status: <strong>{STATE_LABELS[review.responseState] ?? review.responseState}</strong>
          {review.stateReasons.length ? ` (${review.stateReasons.join('; ')})` : ''}
        </p>
      ) : null}
      {review.evidenceText ? (
        <details className="text-xs text-app-text-muted">
          <summary className="cursor-pointer">Evidence used for the draft</summary>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-app-border-subtle p-2">{review.evidenceText}</pre>
        </details>
      ) : null}

      {sent ? (
        <p className="rounded-lg bg-app-border-subtle p-3 text-sm text-app-text">
          <span className="text-app-text-muted">Reply sent: </span>
          {review.reply}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-app-text-muted">
            {review.aiDraft ? 'AI draft (edit before sending)' : 'Write a reply'}
          </p>
          <textarea
            className={field}
            rows={3}
            maxLength={1500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className={btn}
            disabled={pending || !text.trim()}
            onClick={() => run(() => sendReviewReplyAction(review.id, text))}
          >
            Approve &amp; send reply
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          className={btn}
          disabled={pending}
          onClick={() =>
            run(() => setReviewStatusAction(review.id, review.status === 'HIDDEN' ? 'PUBLISHED' : 'HIDDEN'))
          }
        >
          {review.status === 'HIDDEN' ? 'Show review' : 'Hide review'}
        </button>
        {review.hasIssue ? null : (
          <button className={btn} disabled={pending} onClick={() => run(() => createIssueFromReviewAction(review.id))}>
            Create issue from review
          </button>
        )}
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </li>
  );
}

function IssueRow({ issue, builderHref }: { issue: Issue; builderHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  function run(fn: () => Promise<{ error?: string } | { ok: boolean }>) {
    start(async () => {
      const res = await fn();
      setError('error' in res && res.error ? res.error : '');
      router.refresh();
    });
  }

  return (
    <li className="space-y-2 rounded-xl border border-app-border-subtle p-4 text-sm text-app-text">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{issue.title}</strong>
        <span className="text-xs text-app-text-muted">
          {issue.severity} · {issue.status}
          {issue.verifiedAt ? ` · verified ${new Date(issue.verifiedAt).toLocaleDateString()}` : ''}
        </span>
      </div>
      {issue.analysis ? <p className="whitespace-pre-wrap text-app-text-muted">{issue.analysis}</p> : null}
      {issue.proposedPlan ? <pre className="whitespace-pre-wrap rounded-lg bg-app-border-subtle p-2 text-xs">{issue.proposedPlan}</pre> : null}
      <div className="flex flex-wrap gap-2">
        {issue.status === 'OPEN' || issue.status === 'FIX_PROPOSED' ? (
          <button className={btn} disabled={pending} onClick={() => run(() => analyzeIssueAction(issue.id))}>
            {issue.status === 'OPEN' ? 'Analyse with AI' : 'Re-analyse'}
          </button>
        ) : null}
        {issue.status === 'FIX_PROPOSED' ? (
          <button className={btn} disabled={pending} onClick={() => run(() => approveIssueAction(issue.id))}>
            Approve plan
          </button>
        ) : null}
        {issue.status === 'APPROVED' || issue.status === 'DEPLOYED' ? (
          <>
            <button
              className={btn}
              onClick={() => {
                void navigator.clipboard.writeText(issue.fixPrompt).then(() => setCopied(true));
              }}
            >
              {copied ? 'Prompt copied' : 'Copy fix prompt'}
            </button>
            <a className={btn} href={builderHref}>
              Open builder
            </a>
            <button className={btn} disabled={pending} onClick={() => run(() => verifyIssueAction(issue.id))}>
              Check verification
            </button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-app-text-muted">
        Nothing is changed or deployed automatically. Approve the plan, apply it in the builder, publish, and the issue
        is only marked verified after a later passing smoke check.
      </p>
      {error ? <p className="text-red-500">{error}</p> : null}
    </li>
  );
}

export function ReviewsDashboard({
  projectId,
  projectName,
  builderHref,
  settings,
  stats,
  reviews,
  issues,
  knowledge,
  tickets,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState('');
  const [doc, setDoc] = useState({ title: '', content: '' });
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));

  const snippet = `<script src="${origin}/api/projects/${projectId}/reviews/widget" async></script>`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl text-app-text">Reviews &amp; support — {projectName}</h1>
        <p className="mt-1 text-sm text-app-text-muted">
          For your own app&apos;s visitors. Replies are drafted by AI but need your approval unless you turn on
          auto-reply for clean positive reviews.
        </p>
      </header>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Settings</h2>
        <div className="space-y-3 text-sm text-app-text">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Accept reviews on my published app
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.autoReplyPositive}
              onChange={(e) => setForm({ ...form, autoReplyPositive: e.target.checked })}
            />
            Auto-send replies to clearly positive reviews (4–5★, no refund/legal/dispute wording). Everything else
            waits for your approval.
          </label>
          <label className="block">
            Business info the AI may use (hours, policies, contact — it will not invent anything else)
            <textarea
              className={field}
              rows={5}
              maxLength={4000}
              value={form.businessInfo}
              onChange={(e) => setForm({ ...form, businessInfo: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              Tone
              <select
                className={field}
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value as Settings['tone'] })}
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
              </select>
            </label>
            <label className="block">
              Notify email (urgent or negative reviews)
              <input
                className={field}
                type="email"
                value={form.notifyEmail}
                onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            Optional read-only status endpoint (https). When set, only the review reference id is sent to it and
            its answer is used as evidence. Leave empty to disable.
            <input
              className={field}
              type="url"
              placeholder="https://example.com/api/status"
              value={form.statusWebhookUrl}
              onChange={(e) => setForm({ ...form, statusWebhookUrl: e.target.value })}
            />
          </label>
          <button
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveReviewSettingsAction(projectId, form);
                setMessage('error' in res && res.error ? res.error : 'Saved.');
                router.refresh();
              })
            }
          >
            Save settings
          </button>
          {message ? <span className="ml-2 text-app-text-muted">{message}</span> : null}
        </div>
        <div className="mt-4">
          <p className="text-sm text-app-text">Paste this snippet into your app to show reviews and the help assistant:</p>
          <code className="mt-1 block overflow-x-auto rounded-lg bg-app-border-subtle p-3 text-xs text-app-text">
            {snippet}
          </code>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Summary</h2>
        <p className="text-sm text-app-text">
          {stats.total} reviews · average {stats.averageRating || '–'}★ · {stats.sentiment.positive} positive ·{' '}
          {stats.sentiment.neutral} neutral · {stats.sentiment.negative} negative
        </p>
        {stats.topics.length ? (
          <p className="mt-2 text-sm text-app-text-muted">
            Recurring topics: {stats.topics.map((t) => `${t.topic} (${t.count})`).join(', ')}
          </p>
        ) : null}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Reviews</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-app-text-muted">No reviews yet.</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Issues from feedback</h2>
        {issues.length === 0 ? (
          <p className="text-sm text-app-text-muted">No issues yet. Create one from a review.</p>
        ) : (
          <ul className="space-y-3">
            {issues.map((i) => (
              <IssueRow key={i.id} issue={i} builderHref={builderHref} />
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-1 font-display text-lg text-app-text">Support assistant knowledge</h2>
        <p className="mb-3 text-sm text-app-text-muted">
          The assistant answers only from these entries and never reads customer records. Anything else becomes a
          support ticket.
        </p>
        <div className="space-y-2">
          <input
            className={field}
            placeholder="Title or question"
            maxLength={120}
            value={doc.title}
            onChange={(e) => setDoc({ ...doc, title: e.target.value })}
          />
          <textarea
            className={field}
            rows={3}
            placeholder="Answer or details"
            maxLength={4000}
            value={doc.content}
            onChange={(e) => setDoc({ ...doc, content: e.target.value })}
          />
          <button
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await addKnowledgeAction(projectId, doc);
                if ('error' in res && res.error) setMessage(res.error);
                else setDoc({ title: '', content: '' });
                router.refresh();
              })
            }
          >
            Add entry
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {knowledge.map((k) => (
            <li key={k.id} className="flex items-start justify-between gap-3 rounded-lg border border-app-border-subtle p-3">
              <div>
                <p className="text-sm font-medium text-app-text">{k.title}</p>
                <p className="line-clamp-2 text-sm text-app-text-muted">{k.content}</p>
              </div>
              <button
                className={btn}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await deleteKnowledgeAction(k.id);
                    router.refresh();
                  })
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Open support tickets</h2>
        {tickets.length === 0 ? (
          <p className="text-sm text-app-text-muted">No open tickets.</p>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-app-border-subtle p-3">
                <div className="text-sm text-app-text">
                  <p className="whitespace-pre-wrap">{t.question}</p>
                  <p className="text-xs text-app-text-muted">
                    {t.contact ?? 'No contact given'} · {new Date(t.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  className={btn}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await resolveTicketAction(t.id);
                      router.refresh();
                    })
                  }
                >
                  Resolve
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-1 font-display text-lg text-app-text">Your data</h2>
        <p className="mb-3 text-sm text-app-text-muted">
          Download every review for this project as CSV, or permanently delete all reviews, support tickets and issues
          derived from feedback. Deleting cannot be undone.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className={btn} href={`/api/projects/${projectId}/reviews/export`}>
            Export reviews (CSV)
          </a>
          <button
            className={btn}
            disabled={pending}
            onClick={() => {
              if (!window.confirm('Permanently delete ALL reviews, support tickets and feedback issues for this project?')) return;
              start(async () => {
                const result = await deleteAllReviewDataAction(projectId);
                setMessage('error' in result ? result.error : `Deleted ${result.reviews} reviews and ${result.tickets} tickets.`);
                router.refresh();
              });
            }}
          >
            Delete all review data
          </button>
          {message ? <span className="self-center text-sm text-app-text-muted">{message}</span> : null}
        </div>
      </section>
    </div>
  );
}

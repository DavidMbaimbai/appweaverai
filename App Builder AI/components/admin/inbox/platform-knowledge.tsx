'use client';

import { useState, useTransition } from 'react';

import { addPlatformKnowledgeAction, deletePlatformKnowledgeAction } from '@/lib/admin/actions/inbox';

const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';
const field = 'w-full rounded-lg border border-app-border bg-transparent px-2 py-1.5 text-sm text-app-text';

export type KnowledgeRow = { id: string; title: string; content: string };

export function PlatformKnowledgePanel({ entries, canWrite }: { entries: KnowledgeRow[]; canWrite: boolean }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  return (
    <section className="space-y-2 rounded-xl border border-app-border-subtle p-3">
      <h2 className="text-sm font-semibold text-app-text">AppWeaver knowledge (used for platform replies)</h2>
      <p className="text-xs text-app-text-muted">The platform assistant answers only from these entries. Anything else is passed to the team.</p>
      <ul className="space-y-1 text-sm">
        {entries.length === 0 ? <li className="text-app-text-muted">No entries yet: the AI will escalate everything.</li> : null}
        {entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2">
            <span>
              <strong className="text-app-text">{e.title}</strong>
              <span className="block text-xs text-app-text-muted">{e.content.slice(0, 160)}</span>
            </span>
            {canWrite ? (
              <button className={btn} disabled={pending} onClick={() => start(async () => { await deletePlatformKnowledgeAction(e.id); })}>
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <div className="space-y-2">
          <input className={field} placeholder="Title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={`${field} min-h-20`} placeholder="Facts the assistant may state" value={content} maxLength={8000} onChange={(e) => setContent(e.target.value)} />
          <button
            className={btn}
            disabled={pending || !title.trim() || !content.trim()}
            onClick={() =>
              start(async () => {
                const r = await addPlatformKnowledgeAction(title, content);
                setMessage(r.ok ? 'Added.' : r.error);
                if (r.ok) {
                  setTitle('');
                  setContent('');
                }
              })
            }>
            Add entry
          </button>
          {message ? <p className="text-xs text-app-text-muted">{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

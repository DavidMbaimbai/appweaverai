'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import {
  clearAllMemoryAction,
  createMemoryAction,
  exportMemoryMarkdownAction,
  pinMemoryAction,
  refreshCodeMapAction,
  rejectMemoryAction,
  restoreMemoryAction,
  supersedeMemoryAction,
  updateMemoryAction,
} from '@/lib/actions/project-memory';
import { FEATURE_STATES, MEMORY_TYPES, TYPE_LABELS, type MemoryType } from '@/lib/project-memory/types';

export type MemoryEntryView = {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  source: string;
  status: string;
  pinned: boolean;
  featureState: string | null;
  files: string[];
  confidence: number;
  evidence: { files?: string[]; checkpointId?: string; messageId?: string } | null;
  updatedAt: string;
};

type CodeMapView = { path: string; purpose: string; exports: string[]; routes: string[]; dependencies: string[] };

type InjectionView = {
  createdAt: string;
  request: string;
  brief: string;
  tokenEstimate: number;
  memoryTitles: string[];
  protectedFiles: string[];
  unacknowledged: string[];
};

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  canWrite: boolean;
  entries: MemoryEntryView[];
  codeMap: CodeMapView[];
  lastInjection: InjectionView | null;
};

type Draft = { id: string | null; mode: 'create' | 'edit' | 'supersede'; type: MemoryType; title: string; body: string; files: string; featureState: string };

const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';
const field = 'w-full rounded-lg border border-app-border-subtle bg-app-surface px-3 py-2 text-sm text-app-text';

const emptyDraft: Draft = { id: null, mode: 'create', type: 'DECISION', title: '', body: '', files: '', featureState: 'COMPLETED' };

export function MemoryPanel({ projectId, projectName, builderHref, canWrite, entries, codeMap, lastInjection }: Props) {
  const [tab, setTab] = useState<'memory' | 'code' | 'injected'>('memory');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | MemoryType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'SUPERSEDED' | 'REJECTED' | 'ALL'>('ACTIVE');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (statusFilter === 'ALL' || e.status === statusFilter) &&
        (typeFilter === 'ALL' || e.type === typeFilter) &&
        (!q || `${e.title} ${e.body} ${e.files.join(' ')}`.toLowerCase().includes(q)),
    );
  }, [entries, query, typeFilter, statusFilter]);

  const run = (fn: () => Promise<{ error: string } | { ok: true }>, success?: string) =>
    start(async () => {
      const result = await fn();
      const error = 'error' in result ? result.error : undefined;
      setMessage(error ?? success ?? '');
      if (!error) setDraft(null);
    });

  const submitDraft = () => {
    if (!draft) return;
    const input = {
      type: draft.type,
      title: draft.title,
      body: draft.body,
      files: draft.files.split(',').map((f) => f.trim()).filter(Boolean),
      featureState: draft.type === 'FEATURE_STATUS' ? draft.featureState : null,
    };
    if (draft.mode === 'create') run(() => createMemoryAction(projectId, input), 'Entry added.');
    else if (draft.mode === 'edit' && draft.id) run(() => updateMemoryAction(projectId, draft.id as string, input), 'Entry updated.');
    else if (draft.id) run(() => supersedeMemoryAction(projectId, draft.id as string, input), 'Entry superseded.');
  };

  const download = () =>
    start(async () => {
      const result = await exportMemoryMarkdownAction(projectId);
      if ('error' in result) return setMessage(result.error);
      const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    });

  const edit = (e: MemoryEntryView, mode: 'edit' | 'supersede') =>
    setDraft({ id: e.id, mode, type: e.type, title: e.title, body: e.body, files: e.files.join(', '), featureState: e.featureState ?? 'COMPLETED' });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Project memory</h1>
          <p className="text-sm text-app-text-muted">
            What the AI builder remembers about {projectName}. It reads this before every change so finished features stay intact.
          </p>
        </div>
        <Link href={builderHref} className={btn}>Back to builder</Link>
      </header>

      <nav className="flex gap-2" aria-label="Memory sections">
        {([['memory', 'Memory'], ['code', 'Code map'], ['injected', 'Last run injected']] as const).map(([id, label]) => (
          <button key={id} className={`${btn} ${tab === id ? 'bg-app-border-subtle font-medium' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {message ? <p role="status" className="text-sm text-app-text-secondary">{message}</p> : null}

      {tab === 'memory' ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${field} max-w-xs`} placeholder="Search memory" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search memory" />
            <select className={`${field} max-w-[11rem]`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'ALL' | MemoryType)} aria-label="Filter by type">
              <option value="ALL">All types</option>
              {MEMORY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <select className={`${field} max-w-[11rem]`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
              <option value="ACTIVE">Active</option>
              <option value="SUPERSEDED">Superseded</option>
              <option value="REJECTED">Rejected</option>
              <option value="ALL">All statuses</option>
            </select>
            <button className={btn} onClick={download} disabled={pending}>Export markdown</button>
            {canWrite ? <button className={btn} onClick={() => setDraft(emptyDraft)}>Add entry</button> : null}
          </div>

          {draft ? (
            <div className="space-y-2 rounded-xl border border-app-border p-4">
              <h2 className="text-sm font-medium text-app-text">
                {draft.mode === 'create' ? 'Add entry' : draft.mode === 'edit' ? 'Edit entry' : 'Replace entry (the old one is marked superseded)'}
              </h2>
              <select className={field} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as MemoryType })} aria-label="Type">
                {MEMORY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
              {draft.type === 'FEATURE_STATUS' ? (
                <select className={field} value={draft.featureState} onChange={(e) => setDraft({ ...draft, featureState: e.target.value })} aria-label="Feature state">
                  {FEATURE_STATES.map((s) => <option key={s} value={s}>{s === 'PROTECTED' ? 'Protected (the builder must keep it working)' : 'Completed'}</option>)}
                </select>
              ) : null}
              <input className={field} placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Title" />
              <textarea className={field} rows={4} placeholder="What should the builder remember? Never paste keys or passwords." value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Body" />
              <input className={field} placeholder="Related files, comma separated (e.g. components/login.tsx)" value={draft.files} onChange={(e) => setDraft({ ...draft, files: e.target.value })} aria-label="Files" />
              <div className="flex gap-2">
                <button className={btn} disabled={pending} onClick={submitDraft}>Save</button>
                <button className={btn} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          ) : null}

          {visible.length === 0 ? <p className="text-sm text-app-text-muted">No entries match.</p> : null}
          <ul className="space-y-2">
            {visible.map((e) => (
              <li key={e.id} className="space-y-1 rounded-xl border border-app-border-subtle p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-app-text">{e.pinned ? '📌 ' : ''}{e.title}</strong>
                  <span className="text-app-text-muted">
                    {TYPE_LABELS[e.type]}{e.featureState ? ` · ${e.featureState.toLowerCase()}` : ''} · {e.source.toLowerCase()} · {e.status.toLowerCase()} · {Math.round(e.confidence * 100)}% · {new Date(e.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-app-text-secondary">{e.body}</p>
                {e.files.length > 0 ? <p className="text-xs text-app-text-muted">Files: {e.files.join(', ')}</p> : null}
                {e.evidence?.checkpointId || e.evidence?.messageId ? (
                  <p className="text-xs text-app-text-muted">
                    Evidence: {[e.evidence.checkpointId ? `checkpoint ${e.evidence.checkpointId}` : null, e.evidence.messageId ? `message ${e.evidence.messageId}` : null].filter(Boolean).join(', ')}
                  </p>
                ) : null}
                {canWrite ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {e.status === 'ACTIVE' ? (
                      <>
                        <button className={btn} disabled={pending} onClick={() => run(() => pinMemoryAction(projectId, e.id, !e.pinned))}>{e.pinned ? 'Unpin' : 'Pin'}</button>
                        <button className={btn} onClick={() => edit(e, 'edit')}>Edit</button>
                        <button className={btn} onClick={() => edit(e, 'supersede')}>Supersede</button>
                        <button className={btn} disabled={pending} onClick={() => run(() => rejectMemoryAction(projectId, e.id))}>Reject</button>
                      </>
                    ) : (
                      <button className={btn} disabled={pending} onClick={() => run(() => restoreMemoryAction(projectId, e.id))}>Restore</button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 p-3">
              <span className="text-sm text-app-text-secondary">Clear all memory for this project. Type CLEAR to confirm.</span>
              <input className={`${field} max-w-[8rem]`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type CLEAR to confirm" />
              <button
                className={btn}
                disabled={pending || confirmText !== 'CLEAR'}
                onClick={() => run(async () => {
                  const result = await clearAllMemoryAction(projectId, confirmText);
                  if (!('error' in result)) setConfirmText('');
                  return result;
                }, 'Memory cleared.')}
              >
                Clear all
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'code' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-app-text-muted">{codeMap.length} files mapped. Summaries refresh automatically when files change.</p>
            {canWrite ? <button className={btn} disabled={pending} onClick={() => run(() => refreshCodeMapAction(projectId), 'Code map refreshed.')}>Refresh now</button> : null}
          </div>
          <ul className="space-y-2">
            {codeMap.map((c) => (
              <li key={c.path} className="rounded-xl border border-app-border-subtle p-3 text-sm">
                <code className="text-app-text">{c.path}</code>
                <p className="text-app-text-secondary">{c.purpose}</p>
                {c.exports.length ? <p className="text-xs text-app-text-muted">Exports: {c.exports.join(', ')}</p> : null}
                {c.routes.length ? <p className="text-xs text-app-text-muted">Routes: {c.routes.join(', ')}</p> : null}
                {c.dependencies.length ? <p className="text-xs text-app-text-muted">Depends on: {c.dependencies.join(', ')}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === 'injected' ? (
        <section className="space-y-3">
          {!lastInjection ? (
            <p className="text-sm text-app-text-muted">No memory has been injected into a run yet.</p>
          ) : (
            <>
              <p className="text-sm text-app-text-muted">
                Run at {new Date(lastInjection.createdAt).toLocaleString()} · about {lastInjection.tokenEstimate} tokens · {lastInjection.memoryTitles.length} entries
              </p>
              <p className="text-sm text-app-text-secondary">Request: {lastInjection.request}</p>
              {lastInjection.unacknowledged.length > 0 ? (
                <p className="text-sm text-red-500">Protected features edited without acknowledgement: {lastInjection.unacknowledged.join(', ')}</p>
              ) : null}
              {lastInjection.protectedFiles.length > 0 ? <p className="text-xs text-app-text-muted">Protected files: {lastInjection.protectedFiles.join(', ')}</p> : null}
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-app-border-subtle p-3 text-xs text-app-text-secondary">{lastInjection.brief}</pre>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

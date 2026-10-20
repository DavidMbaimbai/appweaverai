'use client';

import { useState, useTransition } from 'react';

import {
  installAssetAction,
  listInstallTargetsAction,
  reportAssetAction,
  startCheckoutAction,
  submitReviewAction,
} from '@/lib/actions/marketplace';
import type { InstallResult } from '@/lib/marketplace/install';
import { REPORT_REASONS } from '@/lib/marketplace/types';

const BTN = 'rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50';
const GHOST = 'rounded-full border border-white/20 px-4 py-2 text-sm text-white disabled:opacity-50';
const FIELD = 'w-full rounded-lg border border-white/20 bg-transparent px-3 py-2 text-sm text-white';

type Projects = Array<{ id: string; name: string; artifacts: Array<{ slug: string; name: string }> }>;

export function BuyButton({ slug, label }: { slug: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  return (
    <div>
      <button
        type="button"
        className={BTN}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await startCheckoutAction(slug);
            if ('url' in res) window.location.href = res.url;
            else setError(res.error);
          })
        }>
        {label}
      </button>
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}

export function InstallPanel({ slug, locked }: { slug: string; locked: string | null }) {
  const [projects, setProjects] = useState<Projects | null>(null);
  const [projectId, setProjectId] = useState('');
  const [artifactSlug, setArtifactSlug] = useState('');
  const [targetDir, setTargetDir] = useState('');
  const [result, setResult] = useState<InstallResult | { status: 'idle' }>({ status: 'idle' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  if (locked) return <p className="text-sm text-white/70">{locked}</p>;

  function load() {
    start(async () => {
      const res = await listInstallTargetsAction();
      if ('error' in res) return setError(res.error);
      setProjects(res.projects);
      const first = res.projects[0];
      if (first) {
        setProjectId(first.id);
        setArtifactSlug(first.artifacts[0]?.slug ?? '');
      }
    });
  }

  function run(strategy: 'abort' | 'skip', dryRun: boolean) {
    setError('');
    start(async () => {
      const res = await installAssetAction({ slug, projectId, artifactSlug, targetDir, strategy, dryRun });
      if (res.status === 'error') setError(res.error);
      setResult(res);
    });
  }

  if (!projects) {
    return (
      <div>
        <button type="button" className={BTN} disabled={pending} onClick={load}>
          Install into a project
        </button>
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      </div>
    );
  }
  if (projects.length === 0) return <p className="text-sm text-white/70">You need a project with an app to install into.</p>;

  const artifacts = projects.find((p) => p.id === projectId)?.artifacts ?? [];
  return (
    <div className="space-y-3">
      <select
        className={FIELD}
        value={projectId}
        onChange={(e) => {
          setProjectId(e.target.value);
          setArtifactSlug(projects.find((p) => p.id === e.target.value)?.artifacts[0]?.slug ?? '');
          setResult({ status: 'idle' });
        }}>
        {projects.map((p) => (
          <option key={p.id} value={p.id} className="text-black">
            {p.name}
          </option>
        ))}
      </select>
      <select className={FIELD} value={artifactSlug} onChange={(e) => setArtifactSlug(e.target.value)}>
        {artifacts.map((a) => (
          <option key={a.slug} value={a.slug} className="text-black">
            {a.name}
          </option>
        ))}
      </select>
      <input className={FIELD} placeholder="Optional sub-folder (e.g. marketplace/landing)" value={targetDir} onChange={(e) => setTargetDir(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={GHOST} disabled={pending || !artifactSlug} onClick={() => run('abort', true)}>
          Preview files
        </button>
        <button type="button" className={BTN} disabled={pending || !artifactSlug} onClick={() => run('abort', false)}>
          Install
        </button>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {result.status === 'preview' || result.status === 'conflicts' ? (
        <div className="rounded-lg border border-white/15 p-3 text-sm">
          {result.conflicts.length > 0 ? (
            <>
              <p className="font-medium text-amber-300">
                {result.conflicts.length} file conflict(s). Nothing is overwritten.
              </p>
              <ul className="mt-2 list-disc pl-5 text-white/80">
                {result.conflicts.map((c) => (
                  <li key={c.path}>
                    <code>{c.path}</code> ({c.reason === 'exists' ? 'already exists' : 'file/folder clash'})
                  </li>
                ))}
              </ul>
              <button type="button" className={`${GHOST} mt-3`} disabled={pending} onClick={() => run('skip', false)}>
                Install, skipping conflicting files
              </button>
            </>
          ) : (
            <p className="text-white/80">No conflicts.</p>
          )}
          {result.status === 'preview' ? (
            <p className="mt-2 text-white/70">Would write {result.writes.length} file(s).</p>
          ) : null}
        </div>
      ) : null}
      {result.status === 'installed' ? (
        <p className="text-sm text-emerald-400">
          Installed version {result.version}: {result.filesWritten.length} file(s) written
          {result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ''}.
        </p>
      ) : null}
    </div>
  );
}

export function ReviewForm({ slug }: { slug: string }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await submitReviewAction(slug, rating, body);
          setMsg('error' in res ? res.error : 'Thanks, your review is posted.');
        });
      }}>
      <select className={FIELD} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n} className="text-black">
            {n} star{n > 1 ? 's' : ''}
          </option>
        ))}
      </select>
      <textarea className={FIELD} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What worked, what did not?" />
      <button type="submit" className={GHOST} disabled={pending}>
        Post review
      </button>
      {msg ? <p className="text-sm text-white/80">{msg}</p> : null}
    </form>
  );
}

export function ReportForm({ slug }: { slug: string }) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-white/70">Report this asset</summary>
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await reportAssetAction(slug, reason, details);
            setMsg('error' in res ? res.error : 'Report received. Our team will review it.');
          });
        }}>
        <select className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)}>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r} className="text-black">
              {r}
            </option>
          ))}
        </select>
        <textarea className={FIELD} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Details" />
        <button type="submit" className={GHOST} disabled={pending}>
          Send report
        </button>
        {msg ? <p className="text-white/80">{msg}</p> : null}
      </form>
    </details>
  );
}

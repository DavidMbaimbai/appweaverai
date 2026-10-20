'use client';

import { useState, useTransition } from 'react';

import {
  pausePlatformPipelineAction,
  pauseProjectPipelineAction,
  runPlatformPipelineNowAction,
  runProjectPipelineNowAction,
  savePlatformPipelineAction,
  saveProjectPipelineAction,
} from '@/lib/content-pipeline/actions';
import { CONTENT_TYPES, PIPELINE_CATEGORIES, SUPPORTED_LANGUAGES, STEP_LABELS, PIPELINE_STEPS } from '@/lib/content-pipeline/types';

export type PipelineView = {
  enabled: boolean;
  paused: boolean;
  timeOfDay: string;
  timeZone: string;
  postsPerDay: number;
  platforms: string[];
  languages: string[];
  contentTypes: string[];
  preferredPostTimes: string[];
  autoPublishCategories: string[];
  objective: string;
  maxDailyCredits: number;
};

export type RunView = {
  id: string;
  runDate: string;
  status: string;
  trigger: string;
  steps: Record<string, { status?: string; detail?: string; error?: string } | undefined>;
  errors: string[];
};

type Props = {
  projectId?: string;
  initial: PipelineView;
  platformOptions: string[];
  runs: RunView[];
  estimateCredits: number | null;
  exists: boolean;
};

const input = 'w-full rounded-lg border border-app-border-subtle bg-app-surface px-3 py-2 text-sm text-app-text';

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function ContentPipelinePanel({ projectId, initial, platformOptions, runs, estimateCredits, exists }: Props) {
  const [form, setForm] = useState(initial);
  const [times, setTimes] = useState(initial.preferredPostTimes.join(', '));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string; message?: string; success?: boolean }>) =>
    start(async () => {
      const result = await fn();
      setMessage(result.error ?? result.message ?? 'Saved.');
    });

  const payload = () => ({
    ...form,
    preferredPostTimes: times.split(',').map((t) => t.trim()).filter(Boolean),
  });

  const save = () => run(() => (projectId ? saveProjectPipelineAction(projectId, payload()) : savePlatformPipelineAction(payload())));
  const pause = () => run(() => (projectId ? pauseProjectPipelineAction(projectId, !form.paused) : pausePlatformPipelineAction(!form.paused)).then((r) => {
    if (!('error' in r)) setForm((f) => ({ ...f, paused: !f.paused }));
    return r;
  }));
  const runNow = () => run(() => (projectId ? runProjectPipelineNowAction(projectId) : runPlatformPipelineNowAction()));

  const checks = (label: string, all: readonly string[], key: 'platforms' | 'languages' | 'contentTypes' | 'autoPublishCategories') => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-app-text-muted">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {all.map((value) => (
          <label key={value} className="flex items-center gap-1.5 text-sm text-app-text">
            <input type="checkbox" checked={form[key].includes(value)} onChange={() => setForm({ ...form, [key]: toggle(form[key], value) })} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-app-border-subtle bg-app-surface p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-app-text-muted">Time of day
            <input className={input} type="time" value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-app-text-muted">Time zone (IANA)
            <input className={input} value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-app-text-muted">Posts per day
            <input className={input} type="number" min={1} value={form.postsPerDay} onChange={(e) => setForm({ ...form, postsPerDay: Number(e.target.value) })} />
          </label>
          <label className="space-y-1 text-xs text-app-text-muted sm:col-span-2">Preferred post times (HH:MM, comma separated)
            <input className={input} value={times} onChange={(e) => setTimes(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-app-text-muted">Max daily credits (0 = no cap)
            <input className={input} type="number" min={0} value={form.maxDailyCredits} onChange={(e) => setForm({ ...form, maxDailyCredits: Number(e.target.value) })} />
          </label>
        </div>
        {checks('Platforms', platformOptions, 'platforms')}
        {checks('Languages', Object.keys(SUPPORTED_LANGUAGES), 'languages')}
        {checks('Content types', CONTENT_TYPES, 'contentTypes')}
        {checks('Categories that may publish without approval (needs AUTONOMOUS mode)', Object.keys(PIPELINE_CATEGORIES), 'autoPublishCategories')}
        <label className="block space-y-1 text-xs text-app-text-muted">Objective
          <textarea className={input} rows={2} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-app-text">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
        </label>
        {estimateCredits !== null && (
          <p className="text-sm text-app-text-muted">Estimated daily cost: about {estimateCredits} credits at list prices (actual usage is reserved and settled per step).</p>
        )}
        <p className="text-xs text-app-text-muted">
          Steps only run while the Content and Marketing Director agents are enabled; image and video steps also need a daily agent budget. Anything not allowed to auto-publish stays a draft awaiting your approval.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-app-text px-3 py-2 text-sm text-app-surface disabled:opacity-50">Save settings</button>
          <button type="button" disabled={pending || !exists} onClick={pause} className="rounded-lg border border-app-border-subtle px-3 py-2 text-sm text-app-text disabled:opacity-50">{form.paused ? 'Resume' : 'Pause'}</button>
          <button type="button" disabled={pending || !exists || form.paused} onClick={runNow} className="rounded-lg border border-app-border-subtle px-3 py-2 text-sm text-app-text disabled:opacity-50">Run now</button>
          {message && <span role="status" className="text-sm text-app-text-muted">{message}</span>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-app-text">Run history</h2>
        {runs.length === 0 && <p className="text-sm text-app-text-muted">No runs yet.</p>}
        {runs.map((r) => (
          <details key={r.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
            <summary className="cursor-pointer text-sm text-app-text">{r.runDate} — {r.status} <span className="text-app-text-muted">({r.trigger})</span></summary>
            <ul className="mt-3 space-y-1 text-xs text-app-text-muted">
              {PIPELINE_STEPS.map((s) => {
                const st = r.steps[s];
                return <li key={s}><strong className="text-app-text">{STEP_LABELS[s]}</strong>: {st?.status ?? 'PENDING'}{st?.detail ? ` — ${st.detail}` : ''}{st?.error ? ` — ${st.error}` : ''}</li>;
              })}
            </ul>
            {r.errors.length > 0 && <p className="mt-2 text-xs text-red-500">{r.errors.join('; ')}</p>}
          </details>
        ))}
      </section>
    </div>
  );
}

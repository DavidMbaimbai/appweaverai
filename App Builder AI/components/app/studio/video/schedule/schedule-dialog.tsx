'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { useToast } from '@/components/ui/toast';
import {
  recommendTimesAction,
  scheduleVideoAction,
  type PatternInput,
  type RecommendationView,
} from '@/lib/actions/video-release';

import { dateTimeLabel, ghostButton, inputClass, primaryButton, type SchedulerData } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANGUAGES = ['es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'ko', 'hi', 'ar'];

type Props = { data: SchedulerData; timeZone: string; open: boolean; onClose: () => void };

export function ScheduleDialog({ data, timeZone, open, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [source, setSource] = useState(data.projects[0] ? `p:${data.projects[0].id}` : data.videos[0] ? `j:${data.videos[0].jobId}` : '');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [kind, setKind] = useState<PatternInput['kind']>('weekly');
  const [time, setTime] = useState('18:00');
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [everyDays, setEveryDays] = useState(2);
  const [explicit, setExplicit] = useState('');
  const [startDate, setStartDate] = useState(data.nowIso.slice(0, 10));
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [rec, setRec] = useState<RecommendationView | null>(null);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function recommend() {
    const platform = platforms[0] ?? 'YOUTUBE';
    start(async () => {
      const r = await recommendTimesAction(platform, timeZone);
      if (r.ok) setRec(r.recommendation);
      else toast.error(r.error);
    });
  }

  function submit(saveAsDraft: boolean) {
    if (!source) return toast.error('Pick a finished video or project first.');
    start(async () => {
      const r = await scheduleVideoAction({
        ...(source.startsWith('p:') ? { videoProjectId: source.slice(2) } : { jobId: source.slice(2) }),
        platforms,
        timeZone,
        pattern: {
          kind,
          time,
          weekdays,
          everyDays,
          localTimes: explicit.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        },
        startDate,
        title,
        caption,
        hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean),
        sourceLanguage: 'en',
        languages,
        saveAsDraft,
      });
      if (!r.ok) return toast.error(r.error);
      toast.success(`${r.created} release(s) ${saveAsDraft ? 'saved as drafts' : 'scheduled — approve them to publish'}.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <AppModalBackdrop open={open} onClose={onClose} className="flex items-center justify-center p-4" panelClassName="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-app-border-subtle bg-app-surface-elevated p-5 shadow-xl">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-app-text">Schedule releases</h2>

        <label className="block space-y-1 text-sm text-app-text">
          Video or series
          <select className={`${inputClass} w-full`} value={source} onChange={(e) => setSource(e.target.value)}>
            {data.projects.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.kind === 'SERIES' ? 'Series' : 'Project'}: {p.title} ({p.episodes} finished)
              </option>
            ))}
            {data.videos.map((v) => (
              <option key={v.jobId} value={`j:${v.jobId}`}>
                Single: {v.label} ({v.seconds}s, {v.aspect})
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1 text-sm text-app-text">
          <legend>Platforms</legend>
          <div className="flex flex-wrap gap-2">
            {data.capabilities.map((c) => (
              <label key={c.platform} className={`${ghostButton} flex items-center gap-1.5`}>
                <input type="checkbox" checked={platforms.includes(c.platform)} onChange={() => setPlatforms(toggle(platforms, c.platform))} />
                {c.label}
                <span className="text-xs text-app-text-muted">{c.effective === 'automatic' ? 'auto' : 'manual'}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 tablet-up:grid-cols-2">
          <label className="space-y-1 text-sm text-app-text">
            Pattern
            <select className={`${inputClass} w-full`} value={kind} onChange={(e) => setKind(e.target.value as PatternInput['kind'])}>
              <option value="weekly">Weekly days (e.g. Mon/Wed/Fri)</option>
              <option value="daily">Daily</option>
              <option value="interval">Every N days</option>
              <option value="explicit">Explicit dates</option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-app-text">
            Start date
            <input type="date" className={`${inputClass} w-full`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {kind !== 'explicit' && (
            <label className="space-y-1 text-sm text-app-text">
              Time ({timeZone})
              <input type="time" className={`${inputClass} w-full`} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
          {kind === 'interval' && (
            <label className="space-y-1 text-sm text-app-text">
              Every N days
              <input type="number" min={1} max={60} className={`${inputClass} w-full`} value={everyDays} onChange={(e) => setEveryDays(Number(e.target.value))} />
            </label>
          )}
        </div>
        {kind === 'weekly' && (
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className={`${ghostButton} flex items-center gap-1`}>
                <input type="checkbox" checked={weekdays.includes(i)} onChange={() => setWeekdays(toggle(weekdays, i))} />
                {d}
              </label>
            ))}
          </div>
        )}
        {kind === 'explicit' && (
          <textarea
            className={`${inputClass} w-full`}
            rows={3}
            placeholder={`One per line or comma separated, local time in ${timeZone}: 2026-11-03T18:00`}
            value={explicit}
            onChange={(e) => setExplicit(e.target.value)}
          />
        )}
        <p className="text-xs text-app-text-muted">
          A series is released in episode order: episode n+1 never publishes before episode n has been published.
        </p>

        <div className="space-y-2 rounded-lg border border-app-border-subtle p-3">
          <button type="button" className={ghostButton} disabled={pending} onClick={recommend}>
            Suggest times
          </button>
          {rec && (
            <div className="space-y-1 text-sm text-app-text">
              <p className="font-medium">{rec.basisLabel}</p>
              <p className="text-app-text-secondary">{rec.explanation}</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {rec.windows.map((w) => (
                  <li key={w.label} className="rounded bg-app-surface-hover px-2 py-0.5">
                    {w.label}
                  </li>
                ))}
              </ul>
              {rec.upcoming.length > 0 && (
                <p className="text-xs text-app-text-muted">
                  Next: {rec.upcoming.slice(0, 3).map((u) => dateTimeLabel(u, timeZone)).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <input className={`${inputClass} w-full`} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={`${inputClass} w-full`} rows={3} placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <input className={`${inputClass} w-full`} placeholder="Hashtags, e.g. ai video launch" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
        </div>

        <fieldset className="space-y-1 text-sm text-app-text">
          <legend>Also release in other languages (title, caption and hashtags are translated with AI — review before approving)</legend>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <label key={l} className={`${ghostButton} flex items-center gap-1`}>
                <input type="checkbox" checked={languages.includes(l)} onChange={() => setLanguages(toggle(languages, l))} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-app-text-muted">
          {data.pendingCount}/{data.pendingLimit} pending releases used on your plan. Nothing publishes until you approve it.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={ghostButton} disabled={pending} onClick={() => submit(true)}>
            Save as draft
          </button>
          <button type="button" className={primaryButton} disabled={pending || platforms.length === 0} onClick={() => submit(false)}>
            {pending ? 'Working…' : 'Schedule'}
          </button>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

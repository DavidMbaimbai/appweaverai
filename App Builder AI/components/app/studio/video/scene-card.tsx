'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useToast } from '@/components/ui/toast';
import {
  cancelVideoJobAction,
  deleteSceneAction,
  generateSceneAction,
  moveSceneAction,
  quoteSceneAction,
  removeSceneImageAction,
  updateSceneAction,
  type SceneQuote,
} from '@/lib/actions/video';

export type SceneJob = {
  id: string;
  status: 'QUEUED' | 'SUBMITTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  error: string | null;
  costCents: number;
};

export type SceneView = {
  id: string;
  prompt: string;
  seconds: number;
  season: number | null;
  episode: number | null;
  hasImage: boolean;
  job: SceneJob | null;
};

const SECONDS_OPTIONS = Array.from({ length: 20 }, (_, i) => (i + 1) * 6);
const inputClass =
  'rounded-lg border border-app-border-subtle bg-app-surface px-2 py-1.5 text-sm text-app-text';
const ghostButton =
  'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';

export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function isActive(job: SceneJob | null) {
  return job?.status === 'QUEUED' || job?.status === 'SUBMITTED' || job?.status === 'RUNNING';
}

function Preview({ jobId }: { jobId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/video/${jobId}/url`);
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? 'Could not load the video.');
      setUrl(data.url);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the video.');
    }
  }, [jobId]);

  useEffect(() => {
    // Fetches a fresh short-lived link on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function download() {
    const response = await fetch(`/api/video/${jobId}/url?download=1`);
    const data = (await response.json()) as { url?: string };
    if (data.url) window.location.assign(data.url);
  }

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!url) return <p className="text-sm text-app-text-muted">Loading preview…</p>;
  return (
    <div className="space-y-2">
      <video
        src={url}
        controls
        playsInline
        className="aspect-video w-full rounded-xl bg-black"
        // Presigned links expire after a few minutes; fetch a new one if playback stops.
        onError={() => void load()}
      />
      <button type="button" onClick={() => void download()} className={ghostButton}>
        Download MP4
      </button>
    </div>
  );
}

export function SceneCard({
  scene,
  index,
  total,
  series,
}: {
  scene: SceneView;
  index: number;
  total: number;
  series: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [prompt, setPrompt] = useState(scene.prompt);
  const [seconds, setSeconds] = useState(scene.seconds);
  const [season, setSeason] = useState(scene.season?.toString() ?? '');
  const [episode, setEpisode] = useState(scene.episode?.toString() ?? '');
  const [quote, setQuote] = useState<SceneQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const job = scene.job;
  const active = isActive(job);
  const imageMode = scene.hasImage;
  const effectiveSeconds = imageMode ? 6 : seconds;

  const toInt = (value: string) => (value.trim() === '' ? null : Number.parseInt(value, 10));

  async function save(overrides: { seconds?: number } = {}) {
    const result = await updateSceneAction(scene.id, {
      prompt,
      seconds: imageMode ? 6 : (overrides.seconds ?? seconds),
      season: toInt(season),
      episode: toInt(episode),
    });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    return true;
  }

  function review() {
    setError(null);
    startTransition(async () => {
      if (!(await save())) return;
      const result = await quoteSceneAction(scene.id);
      if (!result.ok) setError(result.error);
      else setQuote(result.quote);
    });
  }

  function confirm() {
    if (!quote) return;
    startTransition(async () => {
      const result = await generateSceneAction(scene.id, quote.estimatedCostCents);
      setQuote(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Generating. This usually takes a few minutes.');
      router.refresh();
    });
  }

  function cancel() {
    if (!job) return;
    startTransition(async () => {
      const result = await cancelVideoJobAction(job.id);
      if (result.ok) toast.success(result.message);
      else setError(result.error);
      router.refresh();
    });
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      if (!(await save())) return;
      const form = new FormData();
      form.set('file', file);
      form.set('sceneId', scene.id);
      const response = await fetch('/api/video/upload', { method: 'POST', body: form });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error ?? 'Upload failed.');
      else router.refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok && result.error) setError(result.error);
      router.refresh();
    });

  return (
    <article className="space-y-3 rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-app-text">
          Scene {index + 1}
          {series && (scene.season || scene.episode)
            ? ` · S${scene.season ?? '?'}E${scene.episode ?? '?'}`
            : ''}
        </h3>
        <div className="ml-auto flex gap-1">
          <button type="button" aria-label="Move up" disabled={pending || index === 0} className={ghostButton}
            onClick={() => run(() => moveSceneAction(scene.id, 'up'))}>↑</button>
          <button type="button" aria-label="Move down" disabled={pending || index === total - 1} className={ghostButton}
            onClick={() => run(() => moveSceneAction(scene.id, 'down'))}>↓</button>
          <button type="button" disabled={pending || active} className={ghostButton}
            onClick={() => run(() => deleteSceneAction(scene.id))}>Delete</button>
        </div>
      </header>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => void save()}
        rows={3}
        maxLength={4000}
        disabled={active}
        aria-label={`Scene ${index + 1} prompt`}
        placeholder="Describe what happens in this scene: subject, action, setting, camera."
        className={`${inputClass} w-full`}
      />
      <p className="text-xs text-app-text-muted">
        {effectiveSeconds === 6 ? 'Up to 512 characters for a 6s clip.' : 'Up to 4000 characters for clips over 6s.'}
      </p>

      <div className="flex flex-wrap items-center gap-3 text-sm text-app-text">
        <label className="flex items-center gap-2">
          Length
          <select
            value={effectiveSeconds}
            disabled={active || imageMode}
            onChange={(e) => {
              const next = Number(e.target.value);
              setSeconds(next);
              void save({ seconds: next });
            }}
            className={inputClass}>
            {(imageMode ? [6] : SECONDS_OPTIONS).map((value) => (
              <option key={value} value={value}>{value}s</option>
            ))}
          </select>
        </label>
        {series ? (
          <>
            <label className="flex items-center gap-2">
              Season
              <input type="number" min={1} max={999} value={season} disabled={active}
                onChange={(e) => setSeason(e.target.value)} onBlur={() => void save()}
                className={`${inputClass} w-20`} />
            </label>
            <label className="flex items-center gap-2">
              Episode
              <input type="number" min={1} max={999} value={episode} disabled={active}
                onChange={(e) => setEpisode(e.target.value)} onBlur={() => void save()}
                className={`${inputClass} w-20`} />
            </label>
          </>
        ) : null}
        <div className="flex items-center gap-2">
          {imageMode ? (
            <>
              <span className="text-app-text-muted">Reference image attached (6s, 16:9)</span>
              <button type="button" disabled={pending || active} className={ghostButton}
                onClick={() => run(() => removeSceneImageAction(scene.id))}>Remove</button>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <button type="button" disabled={uploading || active} className={ghostButton}
                onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : 'Add reference image'}
              </button>
            </>
          )}
        </div>
      </div>

      {active && job ? (
        <div className="space-y-2" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-app-border-subtle">
            <div className="h-full bg-appweaver-orange transition-[width]" style={{ width: `${Math.max(job.progress, 3)}%` }} />
          </div>
          <p className="text-xs text-app-text-muted">
            {job.status === 'QUEUED' ? 'Waiting to start' : 'Generating'} · about {job.progress}% (estimated) ·
            usually a few minutes
            {job.error ? ` · ${job.error}` : ''}
          </p>
          <button type="button" disabled={pending} onClick={cancel} className={ghostButton}>
            Cancel
          </button>
        </div>
      ) : null}

      {job?.status === 'SUCCEEDED' ? <Preview jobId={job.id} /> : null}
      {job?.status === 'FAILED' ? (
        <p className="text-sm text-red-500">Generation failed: {job.error ?? 'Unknown error.'} You were not charged.</p>
      ) : null}
      {job?.status === 'CANCELLED' ? <p className="text-sm text-app-text-muted">Cancelled.</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {quote ? (
        <div className="space-y-2 rounded-lg border border-app-border-subtle p-3 text-sm text-app-text">
          <p>
            Generating this {quote.seconds}s {quote.mode === 'IMAGE' ? 'image-to-video' : 'text-to-video'} clip
            with {quote.providerLabel} will cost about <strong>{formatUsd(quote.estimatedCostCents)}</strong>.
            You have {quote.remainingThisMonth} video{quote.remainingThisMonth === 1 ? '' : 's'} left this
            month.
          </p>
          {quote.credits > 0 ? (
            <p>
              This costs <strong>{quote.credits} marketing credits</strong>
              {quote.maxCredits > quote.credits ? ` (max ${quote.maxCredits})` : ''}. Your balance: {quote.creditBalance}.
              {quote.creditBalance < quote.maxCredits ? (
                <>
                  {' '}
                  <Link href="/app/marketing-credits" className="font-medium text-appweaver-orange underline">
                    Top up marketing credits
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={confirm}
              className="rounded-lg bg-appweaver-orange px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              Confirm and generate
            </button>
            <button type="button" onClick={() => setQuote(null)} className={ghostButton}>Not now</button>
          </div>
        </div>
      ) : !active ? (
        <button type="button" onClick={review} disabled={pending || uploading || !prompt.trim()}
          className="rounded-lg bg-app-text px-4 py-2 text-sm font-medium text-app-bg disabled:opacity-50">
          {pending ? 'Checking…' : job?.status === 'SUCCEEDED' ? 'Generate again' : 'Generate video'}
        </button>
      ) : null}
    </article>
  );
}

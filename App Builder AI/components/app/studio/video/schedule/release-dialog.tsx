'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { useToast } from '@/components/ui/toast';
import {
  approveReleaseAction,
  cancelReleaseAction,
  pauseReleaseAction,
  resumeReleaseAction,
  retryReleaseAction,
  updateReleaseAction,
} from '@/lib/actions/video-release';
import { toLocalInput } from '@/lib/project-marketing/logic';

import { dateTimeLabel, ghostButton, inputClass, primaryButton, STATUS_LABELS, STATUS_STYLES, type ReleaseView } from './types';

type Props = { release: ReleaseView | null; onClose: () => void };

export function ReleaseDialog({ release, onClose }: Props) {
  if (!release) return null;
  return <Inner key={release.id + release.status} release={release} onClose={onClose} />;
}

function Inner({ release, onClose }: { release: ReleaseView; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(release.title);
  const [caption, setCaption] = useState(release.caption);
  const [hashtags, setHashtags] = useState(release.hashtags.join(' '));
  const [local, setLocal] = useState(toLocalInput(new Date(release.scheduledAt), release.timeZone));
  const editable = ['DRAFT', 'SCHEDULED', 'APPROVED', 'PAUSED', 'FAILED', 'MANUAL'].includes(release.status);

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    start(async () => {
      const r = await work();
      if (!r.ok) return toast.error(r.error ?? 'Failed.');
      toast.success(done);
      onClose();
      router.refresh();
    });
  }

  const save = () =>
    run(
      () =>
        updateReleaseAction(release.id, {
          title,
          caption,
          hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean),
          localTime: local,
        }),
      'Saved. Approval must be given again after edits.',
    );

  return (
    <AppModalBackdrop open onClose={onClose} className="flex items-center justify-center p-4" panelClassName="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-app-border-subtle bg-app-surface-elevated p-5 shadow-xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-app-text">
            {release.platform} · {release.language}
            {release.episode ? ` · S${release.season ?? 1}E${release.episode}` : ''}
          </h2>
          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[release.status]}`}>{STATUS_LABELS[release.status]}</span>
        </div>
        <p className="text-xs text-app-text-muted">
          Scheduled {dateTimeLabel(release.scheduledAt, release.timeZone)} ({release.timeZone}). Attempts: {release.attempts}/3.
        </p>
        {release.error && <p className="rounded bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-300">{release.error}</p>}
        {release.note && <p className="rounded bg-amber-500/10 p-2 text-sm text-app-text">{release.note}</p>}
        {release.postUrl && (
          <a href={release.postUrl} target="_blank" rel="noreferrer" className="text-sm text-appweaver-orange underline">
            View post
          </a>
        )}

        <input className={`${inputClass} w-full`} value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={`${inputClass} w-full`} rows={4} value={caption} disabled={!editable} onChange={(e) => setCaption(e.target.value)} />
        <input className={`${inputClass} w-full`} value={hashtags} disabled={!editable} onChange={(e) => setHashtags(e.target.value)} />
        <label className="block space-y-1 text-sm text-app-text">
          Local time ({release.timeZone})
          <input type="datetime-local" className={`${inputClass} w-full`} value={local} disabled={!editable} onChange={(e) => setLocal(e.target.value)} />
        </label>

        <div className="flex flex-wrap gap-2 text-sm">
          <a className={ghostButton} href={`/api/video/${release.jobId}/url?download=1`}>
            Download video
          </a>
          <a className={ghostButton} href={`/api/video-release/${release.id}/subtitles`}>
            Subtitles (.srt)
          </a>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {editable && (
            <button type="button" className={ghostButton} disabled={pending} onClick={save}>
              Save
            </button>
          )}
          {['DRAFT', 'SCHEDULED'].includes(release.status) && (
            <button type="button" className={primaryButton} disabled={pending} onClick={() => run(() => approveReleaseAction(release.id), 'Approved.')}>
              Approve
            </button>
          )}
          {['SCHEDULED', 'APPROVED'].includes(release.status) && (
            <button type="button" className={ghostButton} disabled={pending} onClick={() => run(() => pauseReleaseAction(release.id), 'Paused.')}>
              Pause
            </button>
          )}
          {release.status === 'PAUSED' && (
            <button type="button" className={ghostButton} disabled={pending} onClick={() => run(() => resumeReleaseAction(release.id), 'Resumed. Approve it again to publish.')}>
              Resume
            </button>
          )}
          {release.status === 'FAILED' && (
            <button type="button" className={primaryButton} disabled={pending} onClick={() => run(() => retryReleaseAction(release.id), 'Retry queued.')}>
              Retry
            </button>
          )}
          {!['PUBLISHED', 'PUBLISHING', 'CANCELLED'].includes(release.status) && (
            <button type="button" className={ghostButton} disabled={pending} onClick={() => run(() => cancelReleaseAction(release.id), 'Cancelled.')}>
              Cancel release
            </button>
          )}
          <button type="button" className={ghostButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

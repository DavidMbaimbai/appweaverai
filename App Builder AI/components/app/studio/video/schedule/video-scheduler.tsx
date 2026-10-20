'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/ui/toast';
import { retryReleaseAction, updateReleaseAction } from '@/lib/actions/video-release';
import { toLocalInput } from '@/lib/project-marketing/logic';

import { ReleaseCalendar } from './calendar';
import { ReleaseDialog } from './release-dialog';
import { ScheduleDialog } from './schedule-dialog';
import {
  dateTimeLabel,
  ghostButton,
  inputClass,
  primaryButton,
  STATUS_LABELS,
  STATUS_STYLES,
  type ReleaseView,
  type SchedulerData,
} from './types';

const CONNECT_MESSAGES: Record<string, string> = {
  youtube: 'YouTube connected.',
  tiktok: 'TikTok connected.',
  error: 'The connection did not complete. Try again.',
};

export function VideoScheduler({ data }: { data: SchedulerData }) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ReleaseView | null>(null);

  const failed = data.releases.filter((r) => r.status === 'FAILED');
  const manual = data.releases.filter((r) => r.status === 'MANUAL');

  const stats = useMemo(() => {
    const byPlatform = new Map<string, { published: number; pending: number; failed: number; views: number | null }>();
    for (const r of data.releases) {
      const s = byPlatform.get(r.platform) ?? { published: 0, pending: 0, failed: 0, views: null };
      if (r.status === 'PUBLISHED') s.published++;
      else if (['SCHEDULED', 'APPROVED', 'PAUSED', 'PUBLISHING'].includes(r.status)) s.pending++;
      else if (r.status === 'FAILED') s.failed++;
      if (r.platform === 'YOUTUBE' && r.views !== null) s.views = (s.views ?? 0) + r.views;
      byPlatform.set(r.platform, s);
    }
    return [...byPlatform.entries()];
  }, [data.releases]);

  function move(release: ReleaseView, day: string) {
    const ownLocal = toLocalInput(new Date(release.scheduledAt), release.timeZone);
    start(async () => {
      const r = await updateReleaseAction(release.id, { localTime: `${day}${ownLocal.slice(10)}` });
      if (r.ok) {
        toast.success('Rescheduled. Approve it again to publish.');
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function retry(id: string) {
    start(async () => {
      const r = await retryReleaseAction(id);
      if (r.ok) {
        toast.success('Retry queued.');
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-6">
      {data.connectFlag && (
        <p className="rounded-lg bg-app-surface-hover p-3 text-sm text-app-text">
          {CONNECT_MESSAGES[data.connectFlag] ?? `Connection: ${data.connectFlag}`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryButton} onClick={() => setCreating(true)}>
          Schedule videos
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-app-text-secondary">
          Time zone
          <input className={`${inputClass} w-56`} value={zone} onChange={(e) => setZone(e.target.value)} list="vr-zones" />
          <datalist id="vr-zones">
            {['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'].map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
        <span className="text-xs text-app-text-muted">
          {data.pendingCount}/{data.pendingLimit} pending
        </span>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">Accounts and delivery</h2>
        <div className="grid gap-2 tablet-up:grid-cols-2">
          {data.capabilities.map((c) => (
            <div key={c.platform} className="space-y-1 rounded-lg border border-app-border-subtle p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-app-text">{c.label}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${c.effective === 'automatic' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-orange-500/15 text-orange-700 dark:text-orange-300'}`}>
                  {c.effective === 'automatic' ? 'Automatic' : 'Manual download'}
                </span>
                <span className="ml-auto text-xs text-app-text-muted">
                  {c.expired ? 'Token expired' : c.connected ? `Connected${c.accountName ? `: ${c.accountName}` : ''}` : 'Not connected'}
                </span>
              </div>
              <p className="text-app-text-secondary">{c.note}</p>
              {c.privateOnly && (
                <p className="font-medium text-amber-700 dark:text-amber-300">Posts will be private until the app is audited.</p>
              )}
              <p className="text-xs text-app-text-muted">Limits: {c.limits}</p>
              {c.deploymentMode === 'automatic' && (!c.connected || c.expired) && (
                <p className="text-xs">
                  {c.connectHref ? (
                    <a className="text-appweaver-orange underline" href={c.connectHref}>
                      {c.expired ? 'Reconnect' : 'Connect'} {c.label}
                    </a>
                  ) : (
                    c.connectHint
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <ReleaseCalendar releases={data.releases} displayZone={zone} onSelect={setSelected} onMove={move} />

      {(failed.length > 0 || manual.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-app-text">Needs attention</h2>
          <ul className="space-y-2">
            {[...failed, ...manual].map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-app-border-subtle p-3 text-sm">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                <button type="button" className="font-medium text-app-text underline" onClick={() => setSelected(r)}>
                  {r.platform} · {r.title}
                </button>
                <span className="text-xs text-app-text-muted">{dateTimeLabel(r.scheduledAt, zone)}</span>
                {r.error && <span className="w-full text-xs text-red-700 dark:text-red-300">{r.error}</span>}
                {r.status === 'FAILED' && (
                  <button type="button" className={`${ghostButton} ml-auto`} onClick={() => retry(r.id)}>
                    Retry
                  </button>
                )}
                {r.status === 'MANUAL' && (
                  <a className={`${ghostButton} ml-auto`} href={`/api/video/${r.jobId}/url?download=1`}>
                    Download video
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">Analytics</h2>
        {stats.length === 0 ? (
          <p className="text-sm text-app-text-muted">No releases yet.</p>
        ) : (
          <table className="w-full text-left text-sm text-app-text">
            <thead className="text-xs text-app-text-muted">
              <tr>
                <th className="py-1">Platform</th>
                <th>Published</th>
                <th>Pending</th>
                <th>Failed</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(([platform, s]) => (
                <tr key={platform} className="border-t border-app-border-subtle">
                  <td className="py-1">{platform}</td>
                  <td>{s.published}</td>
                  <td>{s.pending}</td>
                  <td>{s.failed}</td>
                  <td>{platform === 'YOUTUBE' ? (s.views ?? 'Not yet reported') : 'Unavailable'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-app-text-muted">
          Counts come from this scheduler. Views are shown only for YouTube, as returned by the YouTube API; other
          platforms are not measured.
        </p>
      </section>

      {creating && <ScheduleDialog data={data} timeZone={zone} open onClose={() => setCreating(false)} />}
      <ReleaseDialog release={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

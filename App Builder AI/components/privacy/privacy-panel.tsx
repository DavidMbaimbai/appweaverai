'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  cancelAccountDeletionAction,
  createExportDownloadLinkAction,
  requestAccountDeletionAction,
  requestDataExportAction,
} from '@/lib/actions/privacy';

type ExportRow = { id: string; status: string; createdAt: string; expiresAt: string | null; sizeBytes: number | null; error: string | null };
type Deletion = { status: string; scheduledFor?: string };

const button = 'rounded-full border border-app-border-subtle px-4 py-1.5 text-sm text-app-text hover:bg-app-surface-hover disabled:opacity-50';

export function PrivacyPanel({ exports, deletion }: { exports: ExportRow[]; deletion: Deletion }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const scheduled = deletion.status === 'SCHEDULED';
  const preparing = exports.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING');

  const say = (res: { error: string } | { success: true; message: string; url?: string }) => setMessage('error' in res ? res.error : res.message);

  return (
    <div className="space-y-8">
      {message ? <p className="text-sm text-app-text-secondary">{message}</p> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-app-text">Download your data</h2>
        <p className="text-sm text-app-text-muted">A zip (and single JSON file) with everything we hold about your account. Credentials are not included. Links expire after 15 minutes; files after 7 days.</p>
        <button type="button" className={button} disabled={pending || preparing} onClick={() => start(async () => { say(await requestDataExportAction()); router.refresh(); })}>
          {preparing ? 'Preparing…' : 'Request data export'}
        </button>
        {preparing ? <button type="button" className={button} onClick={() => router.refresh()}>Refresh</button> : null}
        <ul className="space-y-1 text-sm text-app-text">
          {exports.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-3">
              <span>{new Date(job.createdAt).toLocaleString('en-GB')}</span>
              <span className="text-app-text-muted">{job.status.toLowerCase()}{job.error ? `: ${job.error}` : ''}</span>
              {job.status === 'READY' ? (
                <>
                  {(['zip', 'json'] as const).map((format) => (
                    <button key={format} type="button" className="text-appweaver-orange underline" onClick={() => start(async () => {
                      const res = await createExportDownloadLinkAction(job.id);
                      if ('error' in res) return say(res);
                      if (res.url) {
                        const link = document.createElement('a');
                        link.href = `${res.url}&format=${format}`;
                        link.click();
                      }
                    })}>
                      {format.toUpperCase()}
                    </button>
                  ))}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-app-text">Delete your account</h2>
        {scheduled ? (
          <>
            <p className="text-sm text-app-text">Your account is scheduled for permanent deletion on {new Date(deletion.scheduledFor!).toLocaleDateString('en-GB')}.</p>
            <button type="button" className={button} disabled={pending} onClick={() => start(async () => { say(await cancelAccountDeletionAction()); router.refresh(); })}>Cancel deletion</button>
          </>
        ) : (
          <>
            <p className="text-sm text-app-text-muted">
              Deletes your projects, leads, messages, connected accounts and media, and cancels subscriptions, scheduled posts and meetings. Billing and tax records and opt-out lists are kept in anonymised form as the law requires. You have a grace period to change your mind.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input className="rounded-md border border-app-border-subtle bg-app-surface px-2 py-1 text-sm text-app-text" placeholder="Type DELETE" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
              <button type="button" className={button} disabled={pending} onClick={() => start(async () => { say(await requestAccountDeletionAction(confirmation)); router.refresh(); })}>Schedule deletion</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

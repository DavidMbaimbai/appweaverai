'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  adminDismissReportAction,
  adminModerateVersionAction,
  adminSeedFirstPartyAction,
  adminTakedownAssetAction,
} from '@/lib/admin/actions/marketplace';

const BUTTON = 'rounded-full border border-app-border-subtle px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50';

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  function run(task: () => Promise<{ success: true; message: string } | { error: string }>) {
    start(async () => {
      const res = await task();
      setMessage('error' in res ? res.error : res.message);
      router.refresh();
    });
  }
  return { pending, message, run };
}

export function SubmissionControls({ versionId, blocked }: { versionId: string; blocked: boolean }) {
  const { pending, message, run } = useRunner();
  function reject() {
    const reason = window.prompt('Reason shown to the creator:') ?? '';
    if (reason.trim()) run(() => adminModerateVersionAction(versionId, 'reject', reason));
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={BUTTON} disabled={pending || blocked} onClick={() => run(() => adminModerateVersionAction(versionId, 'approve', ''))}>
        Approve
      </button>
      <button type="button" className={BUTTON} disabled={pending} onClick={reject}>
        Reject
      </button>
      {message ? <span className="text-xs text-app-text-secondary">{message}</span> : null}
    </div>
  );
}

export function ReportControls({ reportId, assetId }: { reportId: string; assetId: string }) {
  const { pending, message, run } = useRunner();
  function takedown() {
    const reason = window.prompt('Takedown reason (recorded in the audit log):') ?? '';
    if (reason.trim()) run(() => adminTakedownAssetAction(assetId, reason));
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={BUTTON} disabled={pending} onClick={takedown}>
        Take down asset
      </button>
      <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => adminDismissReportAction(reportId))}>
        Dismiss
      </button>
      {message ? <span className="text-xs text-app-text-secondary">{message}</span> : null}
    </div>
  );
}

export function SeedButton() {
  const { pending, message, run } = useRunner();
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => adminSeedFirstPartyAction())}>
        {pending ? 'Publishing…' : 'Publish first-party free assets'}
      </button>
      {message ? <span className="text-xs text-app-text-secondary">{message}</span> : null}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { refreshLedgerAction, runSmokeAction, verifyIssueAdminAction } from '@/lib/admin/actions/observatory';

const btn =
  'rounded-full border border-app-border-subtle px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover disabled:opacity-50';

type Result = { success: true; message?: string } | { error: string };

export function ObservatoryActions({
  projectId,
  canWrite,
  verifiableIssueIds,
}: {
  projectId: string;
  canWrite: boolean;
  verifiableIssueIds: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  if (!canWrite) return null;

  function run(fn: () => Promise<Result>) {
    start(async () => {
      const res = await fn();
      setMessage('error' in res ? res.error : (res.message ?? 'Done.'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} disabled={pending} onClick={() => run(() => refreshLedgerAction(projectId))}>
        Refresh feature ledger
      </button>
      <button type="button" className={btn} disabled={pending} onClick={() => run(() => runSmokeAction(projectId))}>
        Run smoke check
      </button>
      {verifiableIssueIds.map((id) => (
        <button key={id} type="button" className={btn} disabled={pending} onClick={() => run(() => verifyIssueAdminAction(id))}>
          Verify fix {id.slice(-5)}
        </button>
      ))}
      {message ? <span className="text-xs text-app-text-muted">{message}</span> : null}
    </div>
  );
}

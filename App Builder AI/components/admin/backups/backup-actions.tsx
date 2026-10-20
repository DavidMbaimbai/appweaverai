'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { checkBackupHealthAction } from '@/lib/admin/actions/backups';

export function BackupActions() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className="rounded-full border border-app-border-subtle px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const res = await checkBackupHealthAction();
            setMessage('error' in res ? res.error : res.message);
            router.refresh();
          })
        }
      >
        Check backup health now
      </button>
      {message ? <span className="text-sm text-app-text-secondary">{message}</span> : null}
    </div>
  );
}

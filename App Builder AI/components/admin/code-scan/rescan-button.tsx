'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminRescanProjectAction } from '@/lib/admin/actions/code-scan';

export function RescanButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="rounded-full border border-app-border-subtle px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const res = await adminRescanProjectAction(projectId);
            setMessage('error' in res ? res.error : res.message);
            router.refresh();
          })
        }
      >
        {pending ? 'Scanning…' : 'Rescan'}
      </button>
      {message ? <span className="text-xs text-app-text-secondary">{message}</span> : null}
    </div>
  );
}

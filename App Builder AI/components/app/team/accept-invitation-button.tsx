'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { acceptInvitationAction } from '@/lib/team/actions';

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        className="rounded bg-app-accent px-4 py-2 text-sm text-white disabled:opacity-60"
        onClick={() =>
          start(async () => {
            const r = await acceptInvitationAction(token);
            if (!r.ok) return setError(r.error);
            router.push('/app');
          })
        }
      >
        {pending ? 'Joining…' : 'Accept invitation'}
      </button>
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}

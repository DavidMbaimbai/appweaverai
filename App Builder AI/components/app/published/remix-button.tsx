'use client';

import { useTransition } from 'react';

import { remixProjectAction } from '@/lib/actions/remix';
import { useToast } from '@/components/ui/toast';

export function RemixButton({ projectId }: { projectId: string }) {
  const { error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  function handleRemix() {
    startTransition(async () => {
      const result = await remixProjectAction(projectId);
      // A successful remix redirects server-side and never returns here.
      if (result?.error) {
        toastError(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleRemix}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-60">
      <svg
        className="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true">
        <path
          d="M17 2.1l4 4-4 4M3 12.9v-1a4 4 0 0 1 4-4h13M7 21.9l-4-4 4-4M21 11.1v1a4 4 0 0 1-4 4H4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {isPending ? 'Remixing…' : 'Remix'}
    </button>
  );
}

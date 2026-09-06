'use client';

import { Avatar } from '@/components/ui/avatar';
import { getWorkspaceLabel } from '@/lib/app-data';
import { useEffect, useState } from 'react';
import type { AppWorkspace } from '@/lib/app-types';
import { cn } from '@/lib/utils';

type WorkspaceSelectorProps = {
  workspaces: AppWorkspace[];
  activeWorkspaceSlug?: string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  className?: string;
};

export function WorkspaceSelector({
  workspaces,
  activeWorkspaceSlug,
  user,
  className,
}: WorkspaceSelectorProps) {
  const label = getWorkspaceLabel(workspaces, activeWorkspaceSlug);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const avatarName = user.name ?? user.email;

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40"
          aria-label="Close workspace menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className={cn('relative w-full', className)}>
        {open ? (
          <WorkspaceNamePanel
            label={label}
            className="absolute left-0 top-full z-50 mt-2 min-w-full w-max max-w-[min(100vw-2rem,320px)]"
          />
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Workspace: ${label}`}
          className={cn(
            'relative z-50 flex w-full items-center gap-2.5 rounded-xl border border-app-border bg-app-surface px-2.5 py-2 text-left transition-colors hover:bg-app-surface-hover',
            open && 'bg-app-surface-hover',
          )}>
          <Avatar name={avatarName} image={user.image} size="sm" theme="app" />
          <span className="min-w-0 flex-1 truncate text-sm text-app-text-secondary">
            {label}
          </span>
          <ChevronIcon className="shrink-0 text-app-text-muted" />
        </button>
      </div>
    </>
  );
}

function WorkspaceNamePanel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="menu"
      aria-label="Workspace name"
      className={cn(
        'overflow-hidden rounded-xl border border-app-border bg-app-surface px-3 py-2.5 shadow-[0_16px_48px_rgba(0,0,0,0.4)]',
        className,
      )}>
      <p className="break-words text-sm leading-snug text-app-text">{label}</p>
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}>
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

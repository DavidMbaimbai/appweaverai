'use client';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type AppCommand = {
  id: string;
  keyword: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const appCommands: AppCommand[] = [
  {
    id: 'account',
    keyword: 'account',
    title: 'account',
    description: 'Manage your account',
    href: '/app/account',
    icon: AccountIcon,
  },
  {
    id: 'trash',
    keyword: 'trash',
    title: 'trash',
    description: 'List and restore deleted projects',
    href: '/app/trash',
    icon: TrashIcon,
  },
];

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setTimeout(() => setQuery(''), 0);
      return;
    }

    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return appCommands;

    return appCommands.filter(
      (command) =>
        command.keyword.includes(normalized) ||
        command.title.includes(normalized) ||
        command.description.toLowerCase().includes(normalized),
    );
  }, [query]);

  function navigate(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed top-6 left-[calc(50vw+var(--width-app-sidebar)/2)] z-10 w-full max-w-xl -translate-x-1/2 px-4 tablet-up:top-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="border-b border-app-border-subtle px-4 py-3">
          <div className="flex items-center gap-3">
            <svg
              className="h-4 w-4 shrink-0 text-app-text-muted"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true">
              <path
                d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M16 16l5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              className="w-full bg-transparent text-sm text-app-text placeholder:text-app-text-muted focus:outline-none"
              aria-label="Search apps"
            />
            <kbd className="hidden rounded-md border border-app-border bg-app-input-bg px-1.5 py-0.5 text-[10px] text-app-text-muted tablet-up:inline">
              esc
            </kbd>
          </div>
        </div>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto py-2">
          <p className="px-4 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-app-text-muted">
            Commands
          </p>

          {filteredCommands.length > 0 ? (
            <ul className="px-2">
              {filteredCommands.map((command) => (
                <li key={command.id}>
                  <button
                    type="button"
                    onClick={() => navigate(command.href)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      'hover:bg-app-surface-hover',
                    )}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-input-bg text-app-text-secondary">
                      <command.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-app-text">
                        {command.title}
                      </span>
                      <span className="block truncate text-xs text-app-text-muted">
                        {command.description}
                      </span>
                    </span>
                    <ChevronIcon />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-app-text-muted">
              No commands found
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-app-border-subtle px-4 py-2.5 text-[11px] text-app-text-muted">
          <span>
            <kbd className="rounded border border-app-border bg-app-input-bg px-1 py-0.5">
              ↑↓
            </kbd>{' '}
            navigate
          </span>
          <Link
            href="/app/projects"
            onClick={onClose}
            className="transition-colors hover:text-app-text-secondary">
            Browse all projects
          </Link>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-app-text-muted"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 19.5c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m2 0v11.5A1.5 1.5 0 0 1 15.5 20h-7A1.5 1.5 0 0 1 7 18.5V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 10v6M14 10v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

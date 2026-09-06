'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { moveProjectToTrashAction } from '@/lib/actions/projects';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { AppTier } from '@/lib/billing/entitlements';
import type { AppProjectDetail } from '@/lib/app-types';
import type { PublishVisibility } from '@/lib/publish/visibility';
import { focusVisibleRingStyles } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';
import { publishProjectAction } from '@/lib/actions/publish';

type EditorTopbarProps = {
  project: AppProjectDetail;
  appTier: AppTier;
  onPublished?: (
    deployment: NonNullable<AppProjectDetail['deployment']>,
  ) => void;
};

const linkMenuItems = [
  { label: 'Back to app', href: '/app', icon: HomeIcon },
  { label: 'All projects', href: '/app/projects', icon: ProjectsIcon },
] as const;

export function EditorTopBar({
  project,
  appTier,
  onPublished,
}: EditorTopbarProps) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [visibility, setVisibility] = useState<PublishVisibility>(
    project.deployment?.visibility ?? 'private',
  );
  const [isPending, startTransition] = useTransition();
  const [isPublishing, startPublishTransition] = useTransition();
  const isPro = appTier === 'pro';

  useEffect(() => {
    setTimeout(() => {
      setVisibility(project.deployment?.visibility ?? 'private');
    }, 10);
  }, [project.deployment?.visibility]);

  useEffect(() => {
    if (!isPro && visibility !== 'private') {
      setTimeout(() => {
        setVisibility('private');
      }, 10);
    }
  }, [isPro, visibility]);

  function handlePublish() {
    startPublishTransition(async () => {
      const result = await publishProjectAction(project.id, visibility);

      if (result.error) {
        toastError(result.error);
        return;
      }

      if (result.success && result.url) {
        const deployment = {
          url: result.url,
          visibility: result.visibility ?? visibility,
          publishedAt: new Date().toISOString(),
        };
        onPublished?.(deployment);
        success(
          visibility === 'public'
            ? 'Publised publicly'
            : visibility === 'workspace'
              ? 'Published to workspace'
              : 'Published privately',
        );
        router.refresh();
      }
    });
  }

  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  function handleMoveToTrashClick() {
    setMenuOpen(false);
    setTrashDialogOpen(true);
  }

  function handleConfirmMoveToTrash() {
    startTransition(async () => {
      const result = await moveProjectToTrashAction(project.id);

      if (result?.error) {
        toastError(result.error);
        return;
      }

      setTrashDialogOpen(false);
      success('Project moved to trash');
      router.push('/app/projects');
      router.refresh();
    });
  }

  const isPublished = Boolean(project.deployment);

  return (
    <>
      <header className="relative z-20 flex h-app-editor-topbar shrink-0 items-center justify-between gap-3 border-b border-app-border-subtle bg-app-sidebar-bg/95 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/app"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2.5 text-xs font-medium text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
            <BackIcon />
            App
          </Link>

          <span
            className="hidden h-4 w-px bg-app-border-subtle tablet-up:block"
            aria-hidden="true"
          />

          <Link
            href="/app/projects"
            className="hidden shrink-0 text-sm text-app-text-muted transition-colors hover:text-app-text tablet-up:inline">
            Projects
          </Link>
          <span className="hidden text-app-text-muted/50 tablet-up:inline">
            /
          </span>
          <button
            type="button"
            className="min-w-0 truncate text-sm font-medium text-app-text transition-colors hover:text-app-text-secondary"
            aria-label="Project name">
            {project.name}
          </button>
          <Badge variant={isPublished ? 'orange' : 'muted'} theme="app">
            {isPublished ? 'Published' : 'Draft'}
          </Badge>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as PublishVisibility)
            }
            aria-label="Publish visibility"
            theme="app"
            className="hidden h-9 w-36 tablet-up:block"
            disabled={isPublishing}>
            <option value="public" disabled={!isPro}>
              Public{!isPro ? ' (Pro)' : ''}
            </option>
            <option value="workspace" disabled={!isPro}>
              Workspace only{!isPro ? ' (Pro)' : ''}
            </option>
            <option value="private">Only you</option>
          </Select>
          {!isPro ? (
            <Link
              href="/app/billing"
              className="hidden text-xs text-white hover:underline tablet-up:inline">
              Upgrade
            </Link>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            theme="app"
            disabled={isPublishing}
            onClick={handlePublish}>
            {isPublishing
              ? 'Publishing...'
              : isPublished
                ? 'Republish'
                : 'Publish'}
          </Button>

          {isPublished && project.deployment ? (
            <Link
              href={project.deployment.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'group hidden h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium text-white tablet-up:inline-flex',
                'bg-gradient-to-r from-[#2563eb] via-app-accent-blue to-[#67b8f7]',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_10px_rgba(61,111,212,0.4)]',
                'transition-all duration-200 hover:brightness-110',
                'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_16px_rgba(61,111,212,0.5)]',
                'focus-visible:outline-none focus-visible:ring-2',
                focusVisibleRingStyles.app,
              )}>
              View live
              <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 opacity-90 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
            </Link>
          ) : null}

          <div className="relative">
            {menuOpen ? (
              <button
                type="button"
                className="fixed inset-0 z-40"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              />
            ) : null}

            {menuOpen ? (
              <div
                role="menu"
                aria-label="Project options"
                className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-app-border bg-app-surface py-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
                {linkMenuItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </Link>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleMoveToTrashClick}
                  disabled={isPending}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-replit-orange transition-colors hover:bg-replit-orange/10 disabled:opacity-50">
                  <TrashIcon className="h-3.5 w-3.5 shrink-0" />
                  Move to trash
                </button>
              </div>
            ) : null}

            <IconButton
              label="More options"
              size="sm"
              theme="app"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={cn(menuOpen && 'bg-app-surface-hover')}
              disabled={isPending}>
              <MoreIcon />
            </IconButton>
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={trashDialogOpen}
        onClose={() => setTrashDialogOpen(false)}
        onConfirm={handleConfirmMoveToTrash}
        title="Move to trash?"
        description="This project will be removed from your list. You can restore it from Trash anytime."
        itemName={project.name}
        confirmLabel="Move to trash"
        isPending={isPending}
      />
    </>
  );
}

function BackIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProjectsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="13"
        y="4"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="4"
        y="13"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="13"
        y="13"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
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
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

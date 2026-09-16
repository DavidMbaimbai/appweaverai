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
import { HistoryPanel } from './history-panel';
import { GithubExportPanel } from './github-export-panel';
import { CustomDomainPanel } from './custom-domain-panel';
import { PresenceAvatars } from './presence-avatars';
import { ActivityLogPanel } from './activity-log-panel';
import { TerminalPanel } from './terminal-panel';
import { AnalyticsPanel } from './analytics-panel';

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
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
          <PresenceAvatars projectId={project.id} />
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
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="hidden h-9 shrink-0 items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 text-xs font-medium text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text tablet-up:inline-flex">
            <HistoryIcon className="h-3.5 w-3.5" />
            History
          </button>
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
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                  <HistoryIcon className="h-3.5 w-3.5 shrink-0" />
                  Version history
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setGithubOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                  <GithubIcon className="h-3.5 w-3.5 shrink-0" />
                  Export to GitHub
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDomainOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                  <DomainIcon className="h-3.5 w-3.5 shrink-0" />
                  Custom domain
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setActivityOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                  <ActivityIcon className="h-3.5 w-3.5 shrink-0" />
                  Build &amp; activity log
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setTerminalOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                  <TerminalMenuIcon className="h-3.5 w-3.5 shrink-0" />
                  Terminal
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setAnalyticsOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                  <AnalyticsIcon className="h-3.5 w-3.5 shrink-0" />
                  Analytics
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleMoveToTrashClick}
                  disabled={isPending}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-appweaver-orange transition-colors hover:bg-appweaver-orange/10 disabled:opacity-50">
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

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        projectId={project.id}
      />

      <GithubExportPanel
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        projectId={project.id}
        defaultRepoName={project.slug}
      />

      <CustomDomainPanel
        open={domainOpen}
        onClose={() => setDomainOpen(false)}
        projectId={project.id}
      />

      <ActivityLogPanel
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        projectId={project.id}
      />

      <TerminalPanel
        open={terminalOpen}
        onClose={() => setTerminalOpen(false)}
        projectId={project.id}
        artifacts={project.artifacts}
        defaultArtifactSlug={
          project.artifacts.find(
            (artifact) => artifact.id === project.lastActiveArtifactId,
          )?.slug ??
          project.artifacts[0]?.slug ??
          null
        }
      />

      <AnalyticsPanel
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        projectId={project.id}
        isPublished={isPublished}
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

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M3 12a9 9 0 1 0 2.64-6.36M3 12V6m0 6h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8v4l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.2c-5.5 0-10 4.46-10 9.96 0 4.4 2.87 8.13 6.84 9.45.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.64-1.33-2.22-.25-4.56-1.1-4.56-4.9 0-1.08.39-1.97 1.03-2.66-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.9-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.69 1.03 1.58 1.03 2.66 0 3.81-2.34 4.65-4.57 4.9.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A9.98 9.98 0 0 0 22 12.16c0-5.5-4.5-9.96-10-9.96Z"
      />
    </svg>
  );
}

function DomainIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M3 12h4l2-7 4 14 2-7h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TerminalMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M6.5 9.5 10 12l-3.5 2.5M12 15h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AnalyticsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M4 20V10M11 20V4M18 20v-7"
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

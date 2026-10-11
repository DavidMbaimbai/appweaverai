'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CategoryIcon } from '@/components/shared/category-icons';
import {
  DuplicateIcon,
  ExternalLinkIcon,
  OpenProjectIcon,
  StarIcon,
  TrashIcon,
} from '../shell/user-area-icons';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { focusVisibleRingStyles } from '@/lib/ui-theme';
import { artifactTypeLabels, artifactTypeToCategoryId } from '@/lib/app-types';
import { formatRelativeTime } from '@/lib/app-utils';
import type { AppProject } from '@/lib/app-types';
import {
  artifactStatusLabel,
  artifactStatusVariant,
  getProjectStatus,
} from '@/lib/project-status';
import { cn } from '@/lib/utils';
import {
  PROJECT_LIST_GRID,
  projectDisplaySubtitle,
  projectMetaLine,
} from './project-list-layout';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { duplicateProjectAction } from '@/lib/actions/duplicate';
import { unpublishProjectAction } from '@/lib/actions/publish';
import {
  moveProjectToTrashAction,
  renameProjectAction,
  toggleProjectFavoriteAction,
} from '@/lib/actions/projects';

type ProjectListItemProps = {
  project: AppProject;
};

export function ProjectListItem({ project }: ProjectListItemProps) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isPinned, setIsPinned] = useState(project.isPinned);
  const [isFavoritePending, startFavoriteTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);

  function handleRename() {
    startTransition(async () => {
      const result = await renameProjectAction(project.id, nameDraft);
      if (result?.error) {
        toastError(result.error);
        return;
      }
      setRenaming(false);
      success('Website renamed.');
      router.refresh();
    });
  }

  const href = `/app/projects/${project.workspaceSlug}/${project.slug}`;
  const status = getProjectStatus(project);
  const openedLabel = formatRelativeTime(
    project.lastOpenedAt ?? project.updatedAt,
  );
  const updatedLabel = formatRelativeTime(project.updatedAt);
  const subtitle = projectDisplaySubtitle(project);
  const metaLine = projectMetaLine(project);

  function handleToggleFavorite() {
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);

    startFavoriteTransition(async () => {
      const result = await toggleProjectFavoriteAction(
        project.id,
        nextPinned,
      );

      if (result?.error) {
        setIsPinned(!nextPinned);
        toastError(result.error);
        return;
      }

      router.refresh();
    });
  }

  function handleDuplicate() {
    startTransition(async () => {
      // On success the action redirects to the copy, so only errors return.
      const result = await duplicateProjectAction(project.id);
      if (result?.error) toastError(result.error);
    });
  }

  function handleConfirmUnpublish() {
    startTransition(async () => {
      const result = await unpublishProjectAction(project.id);

      if (result?.error) {
        toastError(result.error);
        return;
      }

      setUnpublishDialogOpen(false);
      success('Website unpublished. It is now a draft.');
      router.refresh();
    });
  }

  function handleConfirmTrash() {
    startTransition(async () => {
      const result = await moveProjectToTrashAction(project.id);

      if (result?.error) {
        toastError(result.error);
        return;
      }

      setTrashDialogOpen(false);
      success('Project moved to trash');
      router.refresh();
    });
  }

  return (
    <>
      <li
        className={cn(
          'group px-5 py-4 transition-colors hover:bg-app-surface-hover/25',
          isPending && 'opacity-70',
        )}>
        <div className={cn('flex flex-col gap-4', PROJECT_LIST_GRID)}>
          {/* Project */}
          <div className="min-w-0 space-y-1">
            {renaming ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleRename();
                }}>
                <input
                  autoFocus
                  value={nameDraft}
                  maxLength={80}
                  aria-label="Website name"
                  onChange={(event) => setNameDraft(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-app-border-subtle bg-transparent px-2 py-1 text-sm text-app-text"
                />
                <button
                  type="submit"
                  disabled={isPending || !nameDraft.trim()}
                  className="text-xs text-appweaver-orange disabled:opacity-50">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(false);
                    setNameDraft(project.name);
                  }}
                  className="text-xs text-app-text-muted">
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-baseline gap-2">
                <Link
                  href={href}
                  className="block min-w-0 text-sm font-medium leading-snug text-app-text transition-colors group-hover:text-appweaver-orange"
                  title={project.name}>
                  <span className="line-clamp-2">{project.name}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="shrink-0 text-xs text-app-text-muted hover:text-appweaver-orange">
                  Rename
                </button>
              </div>
            )}

            <p className="text-xs text-app-text-muted">{metaLine}</p>

            {subtitle ? (
              <p className="line-clamp-1 text-xs leading-relaxed text-app-text-muted/80">
                {subtitle}
              </p>
            ) : null}
          </div>

          {/* Artifacts */}
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-app-text-muted desktop:sr-only">
              Artifacts
            </p>
            {project.artifacts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {project.artifacts.map((artifact) => {
                  const icon = artifactTypeToCategoryId[artifact.type];

                  return (
                    <div
                      key={artifact.id}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-app-border-subtle bg-app-surface/80 py-1 pl-1 pr-2"
                      title={`${artifact.name} (${artifactTypeLabels[artifact.type]})`}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-app-surface-active text-app-text-secondary">
                        {icon ? <CategoryIcon icon={icon} /> : null}
                      </span>
                      <span className="min-w-0 truncate text-xs text-app-text-secondary">
                        {artifact.name}
                      </span>
                      <Badge
                        variant={artifactStatusVariant(artifact.status)}
                        theme="app"
                        className="shrink-0 px-1.5 py-0 text-[10px]">
                        {artifactStatusLabel(artifact.status)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-xs text-app-text-muted">—</span>
            )}
          </div>

          {/* Status */}
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted desktop:sr-only">
              Status
            </p>
            <Badge variant={status.variant} theme="app" className="w-fit">
              {status.label}
            </Badge>
            <p className="text-xs leading-snug text-app-text-muted">
              {project.deployment
                ? `${status.detail} · ${formatRelativeTime(project.deployment.publishedAt)}`
                : status.detail}
            </p>
            {project.deployment ? (
              <button
                type="button"
                onClick={() => setUnpublishDialogOpen(true)}
                disabled={isPending}
                className="text-xs text-app-text-muted underline-offset-2 transition-colors hover:text-appweaver-orange hover:underline">
                Unpublish
              </button>
            ) : null}
          </div>

          {/* Last opened */}
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted desktop:sr-only">
              Last opened
            </p>
            <p className="text-sm tabular-nums text-app-text">{openedLabel}</p>
            <p className="text-xs text-app-text-muted">
              Updated {updatedLabel}
            </p>
          </div>

          {/* Actions - fixed icons slots */}
          <div className="flex items-center justify-end">
            <div className="inline-grid grid-cols-[2rem_2rem_2rem_2rem_2rem] items-center gap-1.5">
              <IconButton
                label={isPinned ? 'Remove from favorites' : 'Add to favorites'}
                size="sm"
                theme="app"
                onClick={handleToggleFavorite}
                disabled={isFavoritePending}
                className={cn(
                  isPinned
                    ? 'text-appweaver-orange'
                    : 'text-app-text-muted hover:text-appweaver-orange',
                )}>
                <StarIcon className="h-3.5 w-3.5" filled={isPinned} />
              </IconButton>
              <Link
                href={href}
                aria-label="Open project"
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  'text-app-text-muted hover:bg-app-surface-hover hover:text-app-text-secondary',
                  'focus-visible:outline-none focus-visible:ring-2',
                  focusVisibleRingStyles.app,
                )}>
                <OpenProjectIcon className="h-3.5 w-3.5" />
              </Link>
              <div className="flex justify-center">
                {project.deployment ? (
                  <a
                    href={project.deployment.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View live site"
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                      'text-app-text-muted hover:bg-app-surface-hover hover:text-app-text-secondary',
                      'focus-visible:outline-none focus-visible:ring-2',
                      focusVisibleRingStyles.app,
                    )}>
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
              <IconButton
                label="Duplicate website"
                size="sm"
                theme="app"
                onClick={handleDuplicate}
                disabled={isPending}
                className="text-app-text-muted hover:text-appweaver-orange">
                <DuplicateIcon className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Move to trash"
                size="sm"
                theme="app"
                onClick={() => setTrashDialogOpen(true)}
                disabled={isPending}
                className="text-app-text-muted hover:text-appweaver-orange">
                <TrashIcon className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
        </div>
      </li>

      <ConfirmDialog
        open={unpublishDialogOpen}
        onClose={() => setUnpublishDialogOpen(false)}
        onConfirm={handleConfirmUnpublish}
        title="Unpublish this website?"
        description="The live site will go offline and the project will return to Draft. You can publish it again anytime."
        itemName={project.name}
        confirmLabel="Unpublish"
        isPending={isPending}
      />

      <ConfirmDialog
        open={trashDialogOpen}
        onClose={() => setTrashDialogOpen(false)}
        onConfirm={handleConfirmTrash}
        title="Move to trash?"
        description="This project will be removed from your list. You can restore it from Trash anytime."
        itemName={project.name}
        confirmLabel="Move to trash"
        isPending={isPending}
      />
    </>
  );
}

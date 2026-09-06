'use client';

import { CategoryIcon } from '@/components/shared/category-icons';
import { AppModalBackdrop } from '@/components/ui/app-modal';
import { createArtifactAction } from '@/lib/actions/artifacts';
import {
  addableArtifactTypes,
  MAX_ARTIFACTS_PER_PROJECT,
} from '@/lib/artifact-types';
import { useTransition } from 'react';
import type {
  ArtifactStatus,
  ArtifactType,
} from '@/lib/generated/prisma/client';
import { cn } from '@/lib/utils';

type AddArtifactDialogProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  currentCount: number;
  onCreated: (artifact: {
    id: string;
    type: ArtifactType;
    name: string;
    slug: string;
    status: ArtifactStatus;
  }) => void;
  onError?: (message: string) => void;
};

export function AddArtifactDialog({
  open,
  onClose,
  projectId,
  currentCount,
  onCreated,
  onError,
}: AddArtifactDialogProps) {
  const [isPending, startTransition] = useTransition();
  const atLimit = currentCount >= MAX_ARTIFACTS_PER_PROJECT;

  function handleClose() {
    if (isPending) return;
    onClose();
  }

  function handleSelect(type: ArtifactType) {
    if (isPending || atLimit) return;

    startTransition(async () => {
      const result = await createArtifactAction(projectId, type);

      if (result.error) {
        onError?.(result.error);
        return;
      }

      if (result.artifact) {
        onCreated(result.artifact);
        onClose();
      }
    });
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={handleClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4"
      className="z-[100]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add artifact"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">Add artifact</h2>
            <p className="mt-0.5 text-sm text-app-text-muted">
              {atLimit
                ? `This project already has ${MAX_ARTIFACTS_PER_PROJECT} artifacts.`
                : 'Choose a canvas type for Agent to build in this project.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text disabled:opacity-60"
            aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-5 tablet-up:grid-cols-4">
          {addableArtifactTypes.map((option) => (
            <button
              key={option.type}
              type="button"
              disabled={isPending || atLimit}
              onClick={() => handleSelect(option.type)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border border-app-border bg-app-prompt-bg px-3 py-4 text-center transition-colors',
                'hover:border-app-text-muted hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
              )}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-app-category-border bg-app-category-bg text-app-text">
                <CategoryIcon icon={option.icon} />
              </span>
              <span className="text-xs font-medium text-app-text-secondary">
                {option.label}
              </span>
            </button>
          ))}
        </div>

        {isPending ? (
          <p className="border-t border-app-border-subtle px-5 py-3 text-center text-sm text-app-text-muted">
            Creating artifact...
          </p>
        ) : null}
      </div>
    </AppModalBackdrop>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

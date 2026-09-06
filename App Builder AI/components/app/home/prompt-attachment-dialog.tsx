'use client';

import { useCallback, useRef, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import {
  MAX_PROMPT_ATTACHMENTS,
  PROMPT_ATTACHMENT_ACCEPT,
  createPromptAttachment,
  formatFileSize,
  validatePromptAttachment,
  type PromptAttachment,
} from '@/lib/prompt-attachments';
import { cn } from '@/lib/utils';

type PromptAttachmentDialogProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (attachments: PromptAttachment[]) => void;
  currentCount: number;
  onError?: (message: string) => void;
  variant?: 'app' | 'landing';
};

export function PromptAttachmentDialog({
  open,
  onClose,
  onAdd,
  currentCount,
  onError,
  variant = 'app',
}: PromptAttachmentDialogProps) {
  const isLanding = variant === 'landing';
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PromptAttachment[]>([]);

  const reset = useCallback(() => {
    setPendingFiles([]);
    setIsDragging(false);
  }, []);

  function handleClose() {
    reset();
    onClose();
  }

  function processFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const remainingSlots =
      MAX_PROMPT_ATTACHMENTS - currentCount - pendingFiles.length;
    if (remainingSlots <= 0) {
      onError?.(`You can attach up to ${MAX_PROMPT_ATTACHMENTS} files.`);
      return;
    }

    const accepted: PromptAttachment[] = [];

    for (const file of files.slice(0, remainingSlots)) {
      const validationError = validatePromptAttachment(file);
      if (validationError) {
        onError?.(validationError);
        continue;
      }

      accepted.push(createPromptAttachment(file));
    }

    if (files.length > remainingSlots) {
      onError?.(
        `Only ${remainingSlots} more file${remainingSlots === 1 ? '' : 's'} can be added.`,
      );
    }

    if (accepted.length > 0) {
      setPendingFiles((current) => [...current, ...accepted]);
    }
  }

  function handleConfirm() {
    if (pendingFiles.length === 0) return;
    onAdd(pendingFiles);
    reset();
    onClose();
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={handleClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4"
      className={isLanding ? 'z-[100]' : undefined}
      backdropClassName={
        isLanding ? 'bg-[#191818]/45 backdrop-blur-[2px]' : undefined
      }>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload files"
        className={cn(
          'w-full max-w-lg overflow-hidden rounded-2xl border',
          isLanding
            ? 'border-[#e3e2dd] bg-surface-white shadow-[0_24px_80px_rgba(0,0,0,0.18)]'
            : 'border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]',
        )}
        onClick={(event) => event.stopPropagation()}>
        <div
          className={cn(
            'flex items-center justify-between border-b px-5 py-4',
            isLanding ? 'border-black/[0.06]' : 'border-app-border-subtle',
          )}>
          <div>
            <h2
              className={cn(
                'font-display text-lg',
                isLanding ? 'text-text-agent-heading' : 'text-app-text',
              )}>
              Add files
            </h2>
            <p
              className={cn(
                'mt-0.5 text-sm',
                isLanding ? 'text-text-muted' : 'text-app-text-muted',
              )}>
              Images, documents, spreadsheets, archives, and more.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              isLanding
                ? 'text-text-muted hover:bg-pricing-surface hover:text-text-secondary'
                : 'text-app-text-muted hover:bg-app-surface-hover hover:text-app-text',
            )}
            aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node))
                return;
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              processFiles(event.dataTransfer.files);
            }}
            className={cn(
              'flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors',
              isDragging
                ? 'border-replit-orange bg-replit-orange/10'
                : isLanding
                  ? 'border-border-light bg-prompt-bg hover:border-[#ffb199]'
                  : 'border-app-border bg-app-prompt-bg hover:border-app-text-muted',
            )}>
            <UploadIcon
              className={cn(
                'mb-4',
                isLanding ? 'text-text-muted' : 'text-app-text-muted',
              )}
            />
            <p
              className={cn(
                'text-sm font-medium',
                isLanding ? 'text-text-primary' : 'text-app-text',
              )}>
              Drag and drop files here
            </p>
            <p
              className={cn(
                'mt-1 text-sm',
                isLanding ? 'text-text-muted' : 'text-app-text-muted',
              )}>
              or
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                'mt-3 rounded-lg border px-4 py-2 text-sm transition-colors',
                isLanding
                  ? 'border-border-light bg-surface-white text-text-primary hover:bg-pricing-surface'
                  : 'border-app-border bg-app-surface text-app-text hover:bg-app-surface-hover',
              )}>
              Choose from computer
            </button>
            <p
              className={cn(
                'mt-4 max-w-sm text-xs leading-relaxed',
                isLanding ? 'text-text-muted' : 'text-app-text-muted',
              )}>
              Upload images, documents, spreadsheets, archives, and code files.
              Each file can be up to 25 MB.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={PROMPT_ATTACHMENT_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files) {
                  processFiles(event.target.files);
                }
                event.target.value = '';
              }}
            />
          </div>

          {pendingFiles.length > 0 ? (
            <ul className="max-h-40 space-y-2 overflow-y-auto">
              {pendingFiles.map((attachment) => (
                <li
                  key={attachment.id}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                    isLanding
                      ? 'border-border-light bg-prompt-bg'
                      : 'border-app-border-subtle bg-app-prompt-bg',
                  )}>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'truncate text-sm',
                        isLanding ? 'text-text-primary' : 'text-app-text',
                      )}>
                      {attachment.file.name}
                    </p>
                    <p
                      className={cn(
                        'text-xs',
                        isLanding ? 'text-text-muted' : 'text-app-text-muted',
                      )}>
                      {formatFileSize(attachment.file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingFiles((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                    className={cn(
                      'shrink-0 text-xs transition-colors hover:text-replit-orange',
                      isLanding ? 'text-text-muted' : 'text-app-text-muted',
                    )}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div
          className={cn(
            'flex items-center justify-end gap-2 border-t px-5 py-4',
            isLanding ? 'border-black/[0.06]' : 'border-app-border-subtle',
          )}>
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              'rounded-lg px-4 py-2 text-sm transition-colors',
              isLanding
                ? 'text-text-muted hover:bg-pricing-surface hover:text-text-secondary'
                : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
            )}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pendingFiles.length === 0}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              pendingFiles.length > 0
                ? isLanding
                  ? 'bg-replit-orange text-white hover:bg-[#e03600]'
                  : 'bg-app-text text-app-bg hover:bg-app-text-secondary'
                : isLanding
                  ? 'cursor-not-allowed bg-[#ffb199]/40 text-white/80'
                  : 'cursor-not-allowed bg-app-surface-active text-app-text-muted',
            )}>
            Add{' '}
            {pendingFiles.length > 0
              ? `${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'}`
              : 'files'}
          </button>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}>
      <path
        d="M12 16V4m0 0L8 8m4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
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

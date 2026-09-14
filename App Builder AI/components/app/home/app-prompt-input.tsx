'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProjectCategory } from '@/lib/types';
import { PromptAttachment } from '@/lib/prompt-attachments';
import { formatFileSize } from '@/lib/prompt-attachments';
import { cn } from '@/lib/utils';
import { CategoryIcon } from '@/components/shared/category-icons';
import { useSpeechRecognition } from '@/lib/hooks/use-speech-recognition';
import { PromptAttachmentDialog } from './prompt-attachment-dialog';

type AppPromptInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  selectedCategory?: ProjectCategory | null;
  onRemoveCategory?: () => void;
  attachments?: PromptAttachment[];
  onAttachmentsChange?: (attachments: PromptAttachment[]) => void;
  planMode?: boolean;
  onPlanModeChange?: (enabled: boolean) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  variant?: 'app' | 'landing';
};

function CategoryTag({
  category,
  onRemove,
  variant = 'app',
}: {
  category: ProjectCategory;
  onRemove: () => void;
  variant?: 'app' | 'landing';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        variant === 'landing'
          ? 'h-8 rounded-lg bg-[#d3e3ff] px-2 text-sm text-[#1a3f8f]'
          : 'h-7 rounded-md bg-app-surface-active px-2 text-xs text-app-text-secondary',
      )}>
      <CategoryIcon icon={category.icon} />
      <span className={variant === 'landing' ? 'font-medium' : undefined}>
        {category.label}
      </span>

      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded',
          variant === 'landing'
            ? 'text-[#1a3f8f]/70 hover:bg-[#1a3f8f]/10 hover:text-[#1a3f8f]'
            : 'text-app-text-muted hover:text-app-text',
        )}
        aria-label={`Remove ${category.label}`}>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}

export function AppPromptInput({
  value,
  onChange,
  onSubmit,
  selectedCategory,
  onRemoveCategory,
  attachments = [],
  onAttachmentsChange,
  planMode = false,
  onPlanModeChange,
  onError,
  disabled,
  variant = 'app',
}: AppPromptInputProps) {
  const isLanding = variant === 'landing';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speechPrefixRef = useRef(value);
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false);
  const hasValue = Boolean(value.trim());
  const hasAttachments = attachments.length > 0;
  const canSubmit = hasValue || hasAttachments;

  const { isListening, isSupported, toggleListening, stopListening } =
    useSpeechRecognition({
      onTranscript: (transcript, isFinal) => {
        const trimmed = transcript.trim();
        if (!trimmed) return;

        if (isFinal) {
          const prefix = speechPrefixRef.current;
          const separator = prefix && !/\s$/.test(prefix) ? ' ' : '';
          const next = `${prefix}${separator}${trimmed}`;
          speechPrefixRef.current = next;
          onChange(next);
          return;
        }

        const prefix = speechPrefixRef.current;
        const separator = prefix && !/\s$/.test(prefix) ? ' ' : '';
        onChange(`${prefix}${separator}${transcript}`);
      },
      onError: (message) => onError?.(message),
    });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = isLanding ? 200 : 160;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [value, isLanding]);

  useEffect(() => {
    if (!isListening) {
      speechPrefixRef.current = value;
    }
  }, [isListening, value]);

  useEffect(() => {
    if (disabled && isListening) {
      stopListening();
    }
  }, [disabled, isListening, stopListening]);

  function handleSubmit() {
    if (!canSubmit || disabled) return;
    stopListening();
    onSubmit?.(value.trim());
  }

  function handleMicClick() {
    if (!isSupported) {
      onError?.(
        'Voice input is not supported in this browser. Try Chrome or Edge.',
      );
      return;
    }

    if (!isListening) {
      speechPrefixRef.current = value;
    }

    toggleListening();
  }

  function handleRemoveAttachment(id: string) {
    onAttachmentsChange?.(
      attachments.filter((attachment) => attachment.id !== id),
    );
  }

  return (
    <>
      <PromptAttachmentDialog
        open={attachmentDialogOpen}
        onClose={() => setAttachmentDialogOpen(false)}
        currentCount={attachments.length}
        variant={variant}
        onAdd={(nextAttachments) =>
          onAttachmentsChange?.([...attachments, ...nextAttachments])
        }
        onError={onError}
      />

      <div
        className={cn(
          isLanding
            ? 'relative isolate w-full'
            : 'relative w-full rounded-2xl border border-app-input-border bg-app-prompt-bg shadow-[inset_0_1px_0_rgba(255,255,255,255,0.03)]',
        )}>
        {isLanding ? (
          <div className="pointer-events-none absolute -inset-2.5 -z-10 animate-[glow-fade-in_0.5s_ease-out_forwards] rounded-2xl bg-[rgba(253,84,2,0.075)] blur-[50px]" />
        ) : null}

        <div
          className={cn(
            'relative',
            isLanding &&
              'rounded-[20px] border border-[#ffb199] bg-[#f3f3f1] transition-[min-height] duration-200',
            isLanding && (canSubmit || selectedCategory) && 'min-h-[120px]',
            isLanding && !canSubmit && !selectedCategory && 'min-h-[88px]',
          )}>
          {attachments.length > 0 ? (
            <div
              className={cn(
                'flex flex-wrap gap-2',
                isLanding ? 'px-3 pt-3' : 'px-4 pt-4',
              )}>
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className={cn(
                    'inline-flex max-w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
                    isLanding
                      ? 'border border-[#dfded8] bg-surface-white text-text-secondary'
                      : 'border border-app-border bg-app-surface text-app-text-secondary',
                  )}>
                  <FileIcon className="shrink-0 text-app-text-muted" />
                  <span className="truncate">{attachment.file.name}</span>
                  <span className="shrink-0 text-app-text-muted">
                    {formatFileSize(attachment.file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(attachment.id)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-app-text-muted hover:text-app-text"
                    aria-label={`Remove ${attachment.file.name}`}>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div
            className={cn(
              isLanding ? 'px-3 pb-12' : 'px-4 pb-14',
              attachments.length > 0 ? 'pt-3' : isLanding ? 'pt-3' : 'pt-4',
            )}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                speechPrefixRef.current = event.target.value;
                onChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                isLanding
                  ? 'Describe your idea, AppWeaver AI will bring it to life...'
                  : 'Make an app that...'
              }
              rows={isLanding ? 1 : 2}
              disabled={disabled}
              className={cn(
                'w-full resize-none bg-transparent focus:outline-none disabled:opacity-60',
                isLanding
                  ? 'max-h-[200px] overflow-hidden px-2 py-1 text-sm leading-normal text-text-primary placeholder:text-[#696c74]'
                  : 'min-h-[56px] text-[15px] leading-relaxed text-app-text placeholder:text-app-text-muted',
              )}
              aria-label={
                isLanding
                  ? 'Describe your idea'
                  : 'Describe what you want to make'
              }
              suppressHydrationWarning={isLanding}
            />
          </div>

          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAttachmentDialogOpen(true)}
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center transition-colors disabled:opacity-60',
                  isLanding
                    ? 'rounded-full bg-[#f3f3f1] text-[#28292c] hover:bg-black/[0.04]'
                    : 'rounded-lg border border-app-border bg-app-surface text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
                )}
                disabled={disabled}
                aria-label="Add attachment">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {planMode ? (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-appweaver-orange/30 bg-appweaver-orange/10 px-2 text-xs text-appweaver-orange">
                  <PlanIcon />
                  Plan mode
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded text-appweaver-orange/80 hover:text-appweaver-orange"
                    aria-label="Disable plan mode"
                    onClick={() => onPlanModeChange?.(false)}>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </span>
              ) : null}

              {selectedCategory && onRemoveCategory ? (
                <CategoryTag
                  category={selectedCategory}
                  onRemove={onRemoveCategory}
                  variant={variant}
                />
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPlanModeChange?.(!planMode)}
                disabled={disabled}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:opacity-60',
                  planMode
                    ? 'border-appweaver-orange/40 bg-appweaver-orange/10 text-appweaver-orange'
                    : isLanding
                      ? 'border-[#dfded8] text-text-muted hover:bg-black-[0.04]'
                      : 'border-app-border text-app-text-muted hover:bg-app-surface-hover hover:text-app-text',
                )}
                aria-label={planMode ? 'Plan mode enabled' : 'Enable plan mode'}
                aria-pressed={planMode}>
                <PlanIcon />
                Plan
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={handleMicClick}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-60',
                  isListening
                    ? 'bg-appweaver-orange/15 text-appweaver-orange'
                    : isLanding
                      ? 'text--[#696c74] hover:bg-black/[0.04]'
                      : 'text-app-text-muted hover:bg-app-surface-hover hover:text-app-text',
                )}
                aria-label={
                  isListening ? 'Stop voice input' : 'Start voice input'
                }
                aria-pressed={isListening}>
                <MicIcon active={isListening} />
              </button>

              {isLanding ? (
                <button
                  type="button"
                  disabled={!canSubmit || disabled}
                  className={cn(
                    'flex items-center justify-center rounded-full transition-all',
                    canSubmit
                      ? 'h-8 gap-1 bg-appweaver-orange px-3 text-sm font-medium text-white'
                      : 'h-8 w-8 bg-[#ffb199] text-white',
                  )}
                  onClick={handleSubmit}
                  aria-label="Start">
                  {canSubmit ? (
                    <>
                      Start
                      <span aria-hidden="true">&#10132;</span>
                    </>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true">
                      <path
                        d="M3.333 8H12.667"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                      />
                      <path
                        d="M8 3.333L12.667 8L8 12.667"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canSubmit || disabled}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                    canSubmit
                      ? 'bg-app-text text-app-bg hover:bg-app-text-secondary'
                      : 'bg-app-surface-active text-app-text-muted',
                  )}
                  onClick={handleSubmit}
                  aria-label="Submit prompt">
                  <ArrowUpIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PlanIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M4 6h16M4 12h10M4 18h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M12 14.5a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5.5a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill={active ? 'currentColor' : 'none'}
      />
      <path
        d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}>
      <path
        d="M8 4h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 4v4h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M12 19V5M12 5l-5 5M12 5l5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


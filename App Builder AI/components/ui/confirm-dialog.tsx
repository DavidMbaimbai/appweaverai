'use client';

import { cn } from '@/lib/utils';
import { TrashIcon } from '../app/shell/user-area-icons';
import { AppModalBackdrop } from './app-modal';
import { Button } from './button';

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  itemName?: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  isPending?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  isPending = false,
}: ConfirmDialogProps) {
  function handleClose() {
    if (isPending) return;
    onClose();
  }
  return (
    <AppModalBackdrop
      open={open}
      onClose={handleClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4"
      className="z-[100]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-app-border-subtle px-5 py-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                variant === 'destructive'
                  ? 'bg-replit-orange/10 text-replit-orange'
                  : 'bg-app-surface-active text-app-text-secondary',
              )}>
              <TrashIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="confirm-dialog-title"
                className="font-display text-lg text-app-text">
                {title}
              </h2>
              <p
                id="confirm-dialog-description"
                className="mt-1 text-sm leading-relaxed text-app-text-muted">
                {description}
              </p>
            </div>
          </div>
        </div>

        {itemName ? (
          <div className="border-b border-app-border-subtle px-5 py-3">
            <p className="truncate rounded-lg border border-app-border-subtle bg-app-surface-active px-3 py-2 text-sm font-medium text-app-text">
              {itemName}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 px-5 py-4 tablet-up:flex-row tablet-up:justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            theme="app"
            onClick={handleClose}
            disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            theme="app"
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              variant === 'destructive' &&
                'bg-replit-orange hover:bg-replit-orange-mid',
            )}>
            {isPending ? 'Working...' : confirmLabel}
          </Button>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

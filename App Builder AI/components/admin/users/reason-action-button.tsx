'use client';

import { useState, useTransition } from 'react';
import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type ActionResult = { success: true } | { error: string };

export function ReasonActionButton({
  label,
  title,
  description,
  confirmLabel,
  variant = 'secondary',
  withExpiry = false,
  onSubmit,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'secondary' | 'primary';
  withExpiry?: boolean;
  onSubmit: (reason: string, expiresAt?: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function handleSubmit() {
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(reason, withExpiry ? expiresAt || undefined : undefined);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success('Done.');
      setOpen(false);
      setReason('');
      setExpiresAt('');
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        theme="app"
        onClick={() => setOpen(true)}>
        {label}
      </Button>

      <AppModalBackdrop
        open={open}
        onClose={() => (isPending ? undefined : setOpen(false))}
        panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <h2 className="text-lg font-medium text-app-text">{title}</h2>
          <p className="mt-1 text-sm text-app-text-muted">{description}</p>

          <label className="mt-4 block text-xs font-medium text-app-text-secondary">
            Reason
          </label>
          <Textarea
            theme="app"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-1 w-full"
            placeholder="Explain why this action is being taken..."
          />

          {withExpiry ? (
            <>
              <label className="mt-3 block text-xs font-medium text-app-text-secondary">
                Expires at (optional, leave blank for permanent)
              </label>
              <Input
                theme="app"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="mt-1 w-full"
              />
            </>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              theme="app"
              disabled={isPending}
              onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              theme="app"
              disabled={isPending}
              onClick={handleSubmit}>
              {isPending ? 'Working...' : confirmLabel}
            </Button>
          </div>
        </div>
      </AppModalBackdrop>
    </>
  );
}

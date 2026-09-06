'use client';

import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useEffect, useState, useTransition } from 'react';

type InlineEditFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  prefix?: string;
  disabled?: boolean;
  savedMessage?: string;
  onSave: (value: string) => Promise<{ error?: string; value?: string | null }>;
};

export function InlineEditField({
  id,
  label,
  value,
  placeholder,
  hint,
  prefix,
  disabled,
  savedMessage,
  onSave,
}: InlineEditFieldProps) {
  const { success, error: toastError } = useToast();
  const [draft, setDraft] = useState(value);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setTimeout(() => {
      setDraft(value);
    }, 0);
  }, [value]);

  function commit() {
    if (disabled || isPending) return;

    const next = draft.trim();
    const current = value.trim();

    if (next === current) return;

    startTransition(async () => {
      const result = await onSave(next);

      if (result.error) {
        toastError(result.error);
        return;
      }

      if (typeof result.value === 'string') {
        setDraft(result.value);
      }

      success(savedMessage ?? `${label} saved`);
    });
  }

  return (
    <div className="grid gap-2 border-b border-app-border-subtle py-4 last:border-b-0 tablet-up:grid-cols-2 tablet-up:items-start tablet-up:gap-6">
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="text-sm font-medium text-app-text">
          {label}
        </label>
        {hint ? <p className="text-xs text-app-text-muted">{hint}</p> : null}
      </div>

      <div className="min-w-0 space-y-1.5">
        <div className="relative">
          {prefix ? (
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-app-text-muted">
              {prefix}
            </span>
          ) : null}
          <Input
            id={id}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            placeholder={placeholder}
            disabled={disabled || isPending}
            theme="app"
            className={cn(prefix && 'pl-7')}
          />
        </div>

        <p className="text-xs text-app-text-muted">
          {isPending ? 'Saving...' : 'Press Enter or click away to save'}
        </p>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { getTemplatePreviewAction } from '@/lib/actions/templates';

type TemplatePreviewDialogProps = {
  slug: string | null;
  name: string;
  actionLabel?: string;
  actionPending?: boolean;
  onAction?: () => void;
  onClose: () => void;
  /** Overrides how the HTML is loaded (e.g. for personal saved sections). */
  loadPreview?: (key: string) => Promise<{ html?: string; error?: string }>;
};

/** Sandboxed preview of a template or section, with a Desktop/Mobile toggle. */
export function TemplatePreviewDialog({
  slug,
  name,
  actionLabel = '',
  actionPending = false,
  onAction,
  onClose,
  loadPreview = getTemplatePreviewAction,
}: TemplatePreviewDialogProps) {
  const [loaded, setLoaded] = useState<{
    slug: string;
    html: string | null;
    error: string | null;
  } | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    loadPreview(slug).then((result) => {
      if (cancelled) return;
      setLoaded({
        slug,
        html: 'html' in result ? (result.html ?? null) : null,
        error: 'error' in result ? (result.error ?? null) : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, loadPreview]);

  useEffect(() => {
    if (!slug) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [slug, onClose]);

  if (!slug) return null;

  const current = loaded?.slug === slug ? loaded : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${name}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface">
        <div className="flex items-center gap-2 border-b border-app-border-subtle px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-app-text">
            {name}
          </p>
          <div className="inline-flex rounded-lg border border-app-border p-0.5">
            {[
              { label: 'Desktop', value: false },
              { label: 'Mobile', value: true },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={mobile === option.value}
                onClick={() => setMobile(option.value)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  mobile === option.value
                    ? 'bg-app-surface-active text-app-text'
                    : 'text-app-text-muted hover:text-app-text'
                }`}>
                {option.label}
              </button>
            ))}
          </div>
          {onAction ? (
            <button
              type="button"
              disabled={actionPending}
              onClick={onAction}
              className="rounded-lg bg-appweaver-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              {actionPending ? 'Working…' : actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="px-2 text-app-text-muted hover:text-app-text">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-[#0a0a0a]">
          {current?.html ? (
            <iframe
              title={`Preview of ${name}`}
              srcDoc={current.html}
              sandbox="allow-scripts"
              className="h-full border-0 bg-white"
              style={{ width: mobile ? 390 : '100%' }}
            />
          ) : (
            <p className="m-auto text-sm text-app-text-muted">
              {current?.error ?? 'Loading preview…'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

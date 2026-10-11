'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { ProjectSeoFields } from '@/lib/seo/project-seo';

type SeoPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSaveStateChange?: (state: 'saving' | 'saved' | 'error') => void;
};

const EMPTY_SEO: ProjectSeoFields = {
  seoTitle: null,
  seoDescription: null,
  seoImageUrl: null,
  faviconUrl: null,
};

export function SeoPanel({
  open,
  onClose,
  projectId,
  onSaveStateChange,
}: SeoPanelProps) {
  const { success, error: toastError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<ProjectSeoFields>(EMPTY_SEO);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/seo`);
        const data = await res.json();
        if (cancelled) return;
        setForm(data.seo ?? EMPTY_SEO);
      } catch {
        if (!cancelled) toastError('Could not load SEO settings.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function handleSave() {
    setIsSaving(true);
    onSaveStateChange?.('saving');
    try {
      const res = await fetch(`/api/projects/${projectId}/seo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) {
        onSaveStateChange?.('error');
        toastError(data.error);
        return;
      }
      setForm(data.seo);
      onSaveStateChange?.('saved');
      success('SEO settings saved.');
    } catch {
      onSaveStateChange?.('error');
      toastError('Could not save SEO settings.');
    } finally {
      setIsSaving(false);
    }
  }

  function updateField(key: keyof ProjectSeoFields, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">SEO</h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Controls how your published site appears in search results and
              social share previews.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Loading…
            </p>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-app-text-secondary">
                Page title
                <Input
                  value={form.seoTitle ?? ''}
                  onChange={(event) =>
                    updateField('seoTitle', event.target.value)
                  }
                  placeholder="Your project name"
                  theme="app"
                  className="mt-1 h-9 w-full"
                />
              </label>
              <label className="block text-xs font-medium text-app-text-secondary">
                Meta description
                <textarea
                  value={form.seoDescription ?? ''}
                  onChange={(event) =>
                    updateField('seoDescription', event.target.value)
                  }
                  placeholder="A short summary shown in search results."
                  rows={3}
                  className="mt-1 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-appweaver-orange/40"
                />
              </label>
              <label className="block text-xs font-medium text-app-text-secondary">
                Social share image URL
                <Input
                  value={form.seoImageUrl ?? ''}
                  onChange={(event) =>
                    updateField('seoImageUrl', event.target.value)
                  }
                  placeholder="https://…/preview.png"
                  theme="app"
                  className="mt-1 h-9 w-full"
                />
              </label>
              <label className="block text-xs font-medium text-app-text-secondary">
                Favicon URL
                <Input
                  value={form.faviconUrl ?? ''}
                  onChange={(event) =>
                    updateField('faviconUrl', event.target.value)
                  }
                  placeholder="https://…/favicon.ico"
                  theme="app"
                  className="mt-1 h-9 w-full"
                />
              </label>
              <Button
                type="button"
                theme="app"
                className="w-full"
                disabled={isSaving}
                onClick={handleSave}>
                {isSaving ? 'Saving…' : 'Save SEO settings'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { BrandKitValues } from '@/lib/brand-kit/project-brand-kit';

type BrandKitPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSaveStateChange?: (state: 'saving' | 'saved' | 'error') => void;
};

const EMPTY_BRAND_KIT: BrandKitValues = {
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
};

const COLOR_FIELDS: {
  key: keyof BrandKitValues;
  label: string;
  placeholder: string;
}[] = [
  { key: 'primaryColor', label: 'Primary color', placeholder: '#ff6a2b' },
  { key: 'secondaryColor', label: 'Secondary color', placeholder: '#1f2937' },
  { key: 'accentColor', label: 'Accent color', placeholder: '#22c55e' },
];

export function BrandKitPanel({
  open,
  onClose,
  projectId,
  onSaveStateChange,
}: BrandKitPanelProps) {
  const { success, error: toastError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<BrandKitValues>(EMPTY_BRAND_KIT);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/brand-kit`);
        const data = await res.json();
        if (cancelled) return;
        setForm(data.brandKit ?? EMPTY_BRAND_KIT);
      } catch {
        if (!cancelled) toastError('Could not load brand kit.');
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
      const res = await fetch(`/api/projects/${projectId}/brand-kit`, {
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
      setForm(data.brandKit);
      onSaveStateChange?.('saved');
      success('Brand kit saved. Reload the preview to see it applied.');
    } catch {
      onSaveStateChange?.('error');
      toastError('Could not save brand kit.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveAsDefault() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/user/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      success('Saved as your default. New websites will start with this kit.');
    } catch {
      toastError('Could not save your default brand kit.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoadDefault() {
    try {
      const res = await fetch('/api/user/brand-kit');
      const data = await res.json();
      if (!data.brandKit) {
        toastError('You have not saved a default brand kit yet.');
        return;
      }
      setForm(data.brandKit);
      success('Default loaded. Save the brand kit to apply it to this site.');
    } catch {
      toastError('Could not load your default brand kit.');
    }
  }

  function updateField(key: keyof BrandKitValues, value: string) {
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
            <h2 className="font-display text-lg text-app-text">Brand kit</h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Logo, colors, and font applied across your published site.
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
                Logo URL
                <Input
                  value={form.logoUrl ?? ''}
                  onChange={(event) =>
                    updateField('logoUrl', event.target.value)
                  }
                  placeholder="https://…/logo.png"
                  theme="app"
                  className="mt-1 h-9 w-full"
                />
                <span className="mt-1 block text-[11px] font-normal text-app-text-muted">
                  Applies to any element in your site tagged{' '}
                  <code>data-aw-logo</code>.
                </span>
              </label>

              <div className="grid grid-cols-3 gap-2">
                {COLOR_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className="block text-xs font-medium text-app-text-secondary">
                    {field.label}
                    <Input
                      value={form[field.key] ?? ''}
                      onChange={(event) =>
                        updateField(field.key, event.target.value)
                      }
                      placeholder={field.placeholder}
                      theme="app"
                      className="mt-1 h-9 w-full"
                    />
                  </label>
                ))}
              </div>

              <label className="block text-xs font-medium text-app-text-secondary">
                Font family
                <Input
                  value={form.fontFamily ?? ''}
                  onChange={(event) =>
                    updateField('fontFamily', event.target.value)
                  }
                  placeholder="'Inter', sans-serif"
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
                {isSaving ? 'Saving…' : 'Save brand kit'}
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  theme="app"
                  variant="secondary"
                  size="sm"
                  disabled={isSaving}
                  onClick={handleSaveAsDefault}>
                  Save as my default
                </Button>
                <Button
                  type="button"
                  theme="app"
                  variant="secondary"
                  size="sm"
                  disabled={isSaving}
                  onClick={handleLoadDefault}>
                  Use my default
                </Button>
              </div>
              <p className="text-[11px] text-app-text-muted">
                Your default kit is applied automatically to every new website
                you create.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

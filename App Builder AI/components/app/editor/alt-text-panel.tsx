'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  listPageImagesAction,
  saveImageAltTextAction,
  type PageImageGroup,
} from '@/lib/actions/alt-text';

type AltTextPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  artifactId: string | null;
  onSaveStateChange?: (state: 'saving' | 'saved' | 'error') => void;
};

const key = (file: string, index: number) => `${file}::${index}`;

export function AltTextPanel({
  open,
  onClose,
  projectId,
  artifactId,
  onSaveStateChange,
}: AltTextPanelProps) {
  const { success, error: toastError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [groups, setGroups] = useState<PageImageGroup[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [decorative, setDecorative] = useState<Record<string, boolean>>({});
  const [originalDecorative, setOriginalDecorative] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!open || !artifactId) return;

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      const result = await listPageImagesAction(projectId, artifactId);
      if (cancelled) return;
      if ('error' in result) {
        toastError(result.error ?? 'Could not load images.');
        setGroups([]);
      } else {
        const initial: Record<string, string> = {};
        const initialDecorative: Record<string, boolean> = {};
        for (const g of result.groups) {
          for (const img of g.images) {
            initial[key(g.file, img.index)] = img.alt ?? '';
            initialDecorative[key(g.file, img.index)] = img.alt === '';
          }
        }
        setGroups(result.groups);
        setValues(initial);
        setOriginal(initial);
        setDecorative(initialDecorative);
        setOriginalDecorative(initialDecorative);
      }
      setIsLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, artifactId]);

  const missingCount = groups.reduce(
    (n, g) =>
      n +
      g.images.filter((img) => original[key(g.file, img.index)] === '' && img.alt === null)
        .length,
    0,
  );

  async function handleSave() {
    if (!artifactId) return;

    const edits: Record<string, Record<number, string>> = {};
    for (const g of groups) {
      for (const img of g.images) {
        const k = key(g.file, img.index);
        const isDecorative = decorative[k] ?? false;
        const wasDecorative = originalDecorative[k] ?? false;
        if (isDecorative) {
          if (!wasDecorative) (edits[g.file] ??= {})[img.index] = '';
        } else if (
          (values[k] ?? '') !== (original[k] ?? '') &&
          (values[k] ?? '').trim() !== ''
        ) {
          (edits[g.file] ??= {})[img.index] = values[k] ?? '';
        }
      }
    }
    if (Object.keys(edits).length === 0) {
      success('No changes to save.');
      return;
    }

    setIsSaving(true);
    onSaveStateChange?.('saving');
    const result = await saveImageAltTextAction(projectId, artifactId, edits);
    setIsSaving(false);

    if ('error' in result && result.error) {
      onSaveStateChange?.('error');
      toastError(result.error);
      return;
    }
    onSaveStateChange?.('saved');
    setOriginal(values);
    setOriginalDecorative(decorative);
    success('Alt text saved. Reload the preview to see it applied.');
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">
              Image alt text
            </h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Describe each image for screen readers and search engines, or
              mark it decorative. Blank fields are left unchanged.
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
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              No images found on your pages yet.
            </p>
          ) : (
            <div className="space-y-4">
              {missingCount > 0 ? (
                <p className="text-xs text-appweaver-orange">
                  {missingCount} image{missingCount === 1 ? '' : 's'} missing
                  alt text.
                </p>
              ) : null}

              {groups.map((g) => (
                <section key={g.file}>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                    {g.file}
                  </h3>
                  <ul className="space-y-3">
                    {g.images.map((img) => {
                      const k = key(g.file, img.index);
                      const previewable = /^(https?:|data:image\/)/i.test(
                        img.src,
                      );
                      return (
                        <li key={k} className="flex items-start gap-3">
                          {previewable ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={img.src}
                              alt=""
                              className="h-12 w-12 shrink-0 rounded-md border border-app-border-subtle object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-app-border-subtle text-[10px] text-app-text-muted">
                              IMG
                            </div>
                          )}
                          <label className="block min-w-0 flex-1 text-xs font-medium text-app-text-secondary">
                            <span className="block truncate font-normal text-app-text-muted">
                              {img.src || '(no source)'}
                            </span>
                            <Input
                              value={values[k] ?? ''}
                              onChange={(event) =>
                                setValues((prev) => ({
                                  ...prev,
                                  [k]: event.target.value,
                                }))
                              }
                              maxLength={300}
                              disabled={decorative[k] ?? false}
                              placeholder="e.g. Cleaner wiping a office desk"
                              theme="app"
                              className="mt-1 h-9 w-full"
                            />
                            <span className="mt-1.5 flex items-center gap-1.5 font-normal text-app-text-muted">
                              <input
                                type="checkbox"
                                checked={decorative[k] ?? false}
                                onChange={(event) =>
                                  setDecorative((prev) => ({
                                    ...prev,
                                    [k]: event.target.checked,
                                  }))
                                }
                              />
                              Decorative (screen readers skip it)
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}

              <Button
                type="button"
                theme="app"
                className="w-full"
                disabled={isSaving}
                onClick={handleSave}>
                {isSaving ? 'Saving…' : 'Save alt text'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

'use client';

import { useState, useTransition } from 'react';

import { useToast } from '@/components/ui/toast';
import { generateContentAction } from '@/lib/actions/content-assistant';
import {
  CONTENT_KINDS,
  CONTENT_TONES,
  type ContentKind,
  type ContentTone,
} from '@/lib/content-assistant';

type ContentAssistantPanelProps = {
  projectId: string;
  activeArtifactId: string | null;
  onApply: (prompt: string) => void;
};

const fieldClass =
  'w-full rounded-lg border border-app-border-subtle bg-transparent px-2 py-1.5 text-xs text-app-text placeholder:text-app-text-muted';

export function ContentAssistantPanel({
  projectId,
  activeArtifactId,
  onApply,
}: ContentAssistantPanelProps) {
  const { error: toastError, success } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ContentKind>('headline');
  const [tone, setTone] = useState<ContentTone>('Professional');
  const [brief, setBrief] = useState('');
  const [currentText, setCurrentText] = useState('');
  const [variants, setVariants] = useState<string[]>([]);

  const kindLabel = CONTENT_KINDS.find((k) => k.id === kind)?.label ?? 'text';

  function handleGenerate() {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }
    startTransition(async () => {
      const result = await generateContentAction({
        projectId,
        artifactId: activeArtifactId,
        kind,
        tone,
        brief,
        currentText,
      });
      if ('error' in result) {
        toastError(result.error ?? 'Could not write text.');
        return;
      }
      setVariants(result.variants);
    });
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      success('Copied.');
    } catch {
      toastError('Could not copy.');
    }
  }

  function handleUse(text: string) {
    onApply(
      `Use this ${kindLabel.toLowerCase()} on my page, replacing the existing one (or adding it in the right place if there is none). Leave everything else unchanged.\n\n${text}`,
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Content assistant
        </h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-appweaver-orange">
          {open ? 'Hide' : 'Write'}
        </button>
      </div>

      {!open ? (
        <p className="text-xs text-app-text-muted">
          Write or improve headlines, service descriptions, About pages and
          more.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ContentKind)}
              className={fieldClass}
              aria-label="What to write">
              {CONTENT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as ContentTone)}
              className={fieldClass}
              aria-label="Tone">
              {CONTENT_TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="What is it for? e.g. weekend deep-cleaning for small offices"
            className={fieldClass}
          />
          <textarea
            value={currentText}
            onChange={(e) => setCurrentText(e.target.value)}
            rows={2}
            maxLength={3000}
            placeholder="Optional: paste existing text to improve"
            className={fieldClass}
          />
          <button
            type="button"
            disabled={isPending || !activeArtifactId}
            onClick={handleGenerate}
            className="w-full rounded-lg bg-appweaver-orange px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {isPending
              ? 'Writing…'
              : currentText.trim()
                ? 'Improve text'
                : 'Write options'}
          </button>

          {variants.length > 0 ? (
            <ul className="space-y-1.5">
              {variants.map((text, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-app-border-subtle px-2.5 py-2">
                  <p className="whitespace-pre-wrap text-sm text-app-text">
                    {text}
                  </p>
                  <div className="mt-1.5 flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleUse(text)}
                      className="text-xs text-appweaver-orange">
                      Use on my page
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy(text)}
                      className="text-xs text-app-text-muted hover:text-app-text">
                      Copy
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

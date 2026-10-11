'use client';

import { useState, useTransition } from 'react';

import { useToast } from '@/components/ui/toast';
import {
  getDesignSuggestionsAction,
  type DesignSuggestion,
} from '@/lib/actions/design-suggestions';

type DesignSuggestionsPanelProps = {
  projectId: string;
  activeArtifactId: string | null;
  onApply: (prompt: string) => void;
};

export function DesignSuggestionsPanel({
  projectId,
  activeArtifactId,
  onApply,
}: DesignSuggestionsPanelProps) {
  const { error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<DesignSuggestion[]>([]);

  function handleSuggest() {
    if (!activeArtifactId) {
      toastError('Select an artifact first.');
      return;
    }
    startTransition(async () => {
      const result = await getDesignSuggestionsAction(
        projectId,
        activeArtifactId,
      );
      if ('error' in result) {
        toastError(result.error ?? 'Could not get suggestions.');
        return;
      }
      setSuggestions(result.suggestions);
    });
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Design suggestions
        </h3>
        <button
          type="button"
          disabled={isPending || !activeArtifactId}
          onClick={handleSuggest}
          className="text-xs text-appweaver-orange disabled:opacity-50">
          {isPending ? 'Reviewing…' : suggestions.length ? 'Refresh' : 'Suggest'}
        </button>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-xs text-app-text-muted">
          Get AI ideas to improve your headline, layout or buttons.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {suggestions.map((s) => (
            <li
              key={s.title}
              className="rounded-lg border border-app-border-subtle px-2.5 py-2">
              <p className="text-sm text-app-text">{s.title}</p>
              <p className="mt-0.5 text-xs text-app-text-muted">{s.detail}</p>
              <button
                type="button"
                onClick={() => onApply(s.prompt)}
                className="mt-1.5 text-xs text-appweaver-orange">
                Apply with AI
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

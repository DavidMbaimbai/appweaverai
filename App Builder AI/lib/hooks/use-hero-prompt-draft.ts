'use client';

import { useEffect, useState } from 'react';
import { loadHeroPromptDraft } from '../hero-prompt-draft';
import { projectCategories } from '../landing-data';
import type { PromptAttachment } from '../prompt-attachments';
import type { ProjectCategory } from '../types';

export function useHeroPromptDraftRestore() {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [planMode, setPlanMode] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<ProjectCategory | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function restore() {
      const draft = loadHeroPromptDraft();
      const storedAttachments = await [];

      if (draft) {
        setValue(draft.value);
        setPlanMode(draft.planMode);
        if (draft.categoryId) {
          const category = projectCategories.find(
            (item) => item.id === draft.categoryId,
          );
          if (category) setSelectedCategory(category);
        }
      }

      if (storedAttachments.length > 0) {
        setAttachments(storedAttachments);
      }

      setReady(true);
    }

    void restore();
  }, []);

  return {
    value,
    setValue,
    attachments,
    setAttachments,
    planMode,
    setPlanMode,
    selectedCategory,
    setSelectedCategory,
    ready,
  };
}

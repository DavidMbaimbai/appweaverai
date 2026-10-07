'use client';

import { CategoryCarousel } from '@/components/shared/category-carousel';
import { ExamplePrompts } from '@/components/shared/example-prompts';
import { getDisplayName } from '@/lib/app-data';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { ProjectCategory } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { AppPromptInput } from './app-prompt-input';
import { useHeroPromptDraftRestore } from '@/lib/hooks/use-hero-prompt-draft';
import {
  buildProjectFormData,
  clearHeroPromptState,
  loadHeroPromptDraft,
} from '@/lib/hero-prompt-draft';
import { createProjectAction, importGithubRepoAction } from '@/lib/actions/projects';
import {
  GithubRepoPicker,
  type GithubRepoOption,
} from '@/components/app/editor/github-repo-picker';

type AppHomeProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export function AppHome({ user }: AppHomeProps) {
  const searchParams = useSearchParams();
  const { error: toastError } = useToast();

  const {
    value,
    setValue,
    attachments,
    setAttachments,
    planMode,
    setPlanMode,
    selectedCategory,
    setSelectedCategory,
    ready,
  } = useHeroPromptDraftRestore();

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const autostartedRef = useRef(false);
  const [githubPickerOpen, setGithubPickerOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const displayName = getDisplayName(user?.name, user?.email);

  function submitProject(
    prompt: string,
    nextAttachments: typeof attachments,
    nextPlanMode: boolean,
    nextCategory: ProjectCategory | null,
  ) {
    setError(null);

    startTransition(async () => {
      const formData = buildProjectFormData({
        prompt,
        planMode: nextPlanMode,
        categoryId: nextCategory?.id,
        attachments: nextAttachments,
      });

      const result = await createProjectAction(formData);
      if (result && 'error' in result && result.error) {
        setError(result.error);
        toastError(result.error);
        return;
      }
      await clearHeroPromptState();
    });
  }

  useEffect(() => {
    if (!ready || autostartedRef.current || isPending) return;

    const shouldAutostart =
      searchParams.get('autostart') === '1' || loadHeroPromptDraft()?.autostart;

    if (!shouldAutostart) return;

    const draft = loadHeroPromptDraft();
    const prompt = draft?.value?.trim() ?? value.trim();
    const hasContent = Boolean(prompt) || attachments.length > 0;

    if (!hasContent) return;

    autostartedRef.current = true;
    void clearHeroPromptState();
    setTimeout(() => {
      submitProject(
        prompt,
        attachments,
        draft?.planMode ?? planMode,
        selectedCategory,
      );
    }, 100);
  }, [
    ready,
    searchParams,
    value,
    attachments,
    planMode,
    selectedCategory,
    isPending,
    submitProject,
  ]);

  function handleCategoryToggle(category: ProjectCategory) {
    setSelectedCategory((current) =>
      current?.id === category.id ? null : category,
    );
  }

  function handleSubmit(prompt: string) {
    submitProject(prompt, attachments, planMode, selectedCategory);
  }

  function handleExampleSelect(text: string) {
    setValue(text);
  }

  async function handleImportSelect(repo: GithubRepoOption, branch: string) {
    setIsImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('owner', repo.owner);
      formData.set('repo', repo.name);
      formData.set('branch', branch);
      const result = await importGithubRepoAction(formData);
      if (result && 'error' in result && result.error) {
        setError(result.error);
        toastError(result.error);
      }
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex w-full flex-1 flex-col items-center justify-center px-4 py-8 tablet-up:px-8">
        <h1 className="max-w-3xl text-center font-display text-[32px] font-normal leading-tight tracking-[-0.03em] text-app-text tablet-up:text-[40px]">
          Hi {displayName}, what do you want to make?
        </h1>

        <div className="mt-8 w-full max-w-[720px]">
          <AppPromptInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            selectedCategory={selectedCategory}
            onRemoveCategory={() => setSelectedCategory(null)}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            planMode={planMode}
            onPlanModeChange={setPlanMode}
            onError={toastError}
            disabled={isPending}
          />

          {error ? (
            <p className="mt-3 text-center text-sm text-appweaver-orange">
              {error}
            </p>
          ) : null}

          {isPending ? (
            <p className="mt-3 text-center text-sm text-app-text-muted">
              Creating your project...
            </p>
          ) : null}

          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setGithubPickerOpen(true)}
              disabled={isPending || isImporting}
              className="text-sm text-app-text-muted underline-offset-2 transition-colors hover:text-app-text hover:underline disabled:opacity-50">
              {isImporting ? 'Importing…' : 'or import an existing GitHub repo →'}
            </button>
          </div>
        </div>

        <div className="mx-auto mt-[17px] w-full max-w-hero-prompt tablet-up:max-w-hero-prompt-tablet">
          <CategoryCarousel
            variant="app"
            selectedCategoryId={selectedCategory?.id ?? null}
            onCategoryToggle={handleCategoryToggle}
          />
        </div>

        <div className="mt-10 w-full max-w-[720px]">
          <ExamplePrompts variant="app" onSelect={handleExampleSelect} />
        </div>
      </div>

      <GithubRepoPicker
        open={githubPickerOpen}
        onClose={() => setGithubPickerOpen(false)}
        onSelect={handleImportSelect}
        isSubmitting={isImporting}
        title="Import from GitHub"
        description="Pick a repository and branch to start a new project from it."
        confirmLabel="Import & create project"
      />
    </main>
  );
}

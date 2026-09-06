'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ProjectCategory } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { ExamplePrompts } from '@/components/shared/example-prompts';
import { CategoryCarousel } from '@/components/landing/hero/category-carousel';
import { authClient } from '@/lib/auth-client';
import { useAuthModal } from '@/components/auth/auth-modal-provider';
import { useHeroPromptDraftRestore } from '@/lib/hooks/use-hero-prompt-draft';
import { AppPromptInput } from '@/components/app/home/app-prompt-input';
import { persistHeroPromptState } from '@/lib/hero-prompt-draft';

const APP_AUTOSTART_URL = '/app?autostart=1';

export function HeroPromptArea() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { openAuthModal } = useAuthModal();
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

  useEffect(() => {
    if (!ready) return;
    void persistHeroPromptState({
      value,
      categoryId: selectedCategory?.id ?? null,
      planMode,
      attachments,
      autostart: false,
    });
  }, [value, selectedCategory, planMode, attachments, ready]);

  function handleSelect(text: string) {
    setValue(text);
  }

  function handleCategoryToggle(category: ProjectCategory) {
    setSelectedCategory((current) =>
      current?.id === category.id ? null : category,
    );
  }

  function openLogin() {
    void persistHeroPromptState({
      value,
      categoryId: selectedCategory?.id ?? null,
      planMode,
      attachments,
      autostart: true,
    });

    const params = new URLSearchParams(window.location.search);
    params.set('auth', 'login');
    params.set('callbackUrl', APP_AUTOSTART_URL);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/?${query}` : '/');
    openAuthModal('login');
  }

  async function handleStart(prompt: string) {
    await persistHeroPromptState({
      value: prompt,
      categoryId: selectedCategory?.id ?? null,
      planMode,
      attachments,
      autostart: true,
    });

    if (isPending) return;

    if (!session?.user) {
      openLogin();
      return;
    }

    router.push(APP_AUTOSTART_URL);
  }

  return (
    <>
      <div className="mx-auto w-full max-w-hero-prompt">
        <AppPromptInput
          variant="landing"
          value={value}
          onChange={setValue}
          onSubmit={handleStart}
          selectedCategory={selectedCategory}
          onRemoveCategory={() => setSelectedCategory(null)}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          planMode={planMode}
          onPlanModeChange={setPlanMode}
          onError={toastError}
        />
      </div>

      <div className="mx-auto mt-[17px] w-full max-w-hero-prompt tablet-up:max-w-hero-prompt-tablet">
        <CategoryCarousel
          selectedCategoryId={selectedCategory?.id ?? null}
          onCategoryToggle={handleCategoryToggle}
        />
      </div>

      <div className="mx-auto mt-3.5 hidden w-full max-w-hero-prompt desktop:block">
        <ExamplePrompts onSelect={handleSelect} />
      </div>
    </>
  );
}

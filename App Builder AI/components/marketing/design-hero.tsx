'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth-client';
import { useAuthModal } from '@/components/auth/auth-modal-provider';
import { useHeroPromptDraftRestore } from '@/lib/hooks/use-hero-prompt-draft';
import { AppPromptInput } from '@/components/app/home/app-prompt-input';
import { persistHeroPromptState } from '@/lib/hero-prompt-draft';

const APP_AUTOSTART_URL = '/app?autostart=1';

const quickActions: Array<{
  id: 'import-url' | 'import-figma' | 'recreate-screenshot' | 'design-system';
  label: string;
  icon: (props: { className?: string }) => React.JSX.Element;
  comingSoon?: boolean;
}> = [
  {
    id: 'import-url',
    label: 'Import URL',
    icon: LinkIcon,
  },
  {
    id: 'import-figma',
    label: 'Import Figma',
    icon: FigmaIcon,
    comingSoon: true,
  },
  {
    id: 'recreate-screenshot',
    label: 'Recreate screenshot',
    icon: ImageIcon,
  },
  {
    id: 'design-system',
    label: 'Start with a design system',
    icon: SwatchIcon,
  },
];

export function DesignHero() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { openAuthModal } = useAuthModal();
  const { success, error: toastError } = useToast();
  const [attachmentSignal, setAttachmentSignal] = useState(0);
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
    window.history.replaceState(null, '', query ? `/design?${query}` : '/design');
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

  function handleQuickAction(id: (typeof quickActions)[number]['id']) {
    if (id === 'import-figma') {
      success('Figma import is coming soon — describe your design in words for now.');
      return;
    }

    if (id === 'recreate-screenshot') {
      setValue((current) =>
        current
          ? current
          : 'Recreate this screenshot as a pixel-perfect, responsive UI:',
      );
      setAttachmentSignal((n) => n + 1);
      return;
    }

    if (id === 'import-url') {
      const url = window.prompt('Paste the URL of the site you want to recreate:');
      if (!url) return;
      setValue(
        `Recreate the design and layout of ${url.trim()} as a modern, responsive web app UI.`,
      );
      return;
    }

    if (id === 'design-system') {
      setValue(
        'Start with a clean, modern design system: a cohesive color palette, consistent spacing and typography, and reusable components for buttons, cards, forms, and navigation.',
      );
    }
  }

  return (
    <div className="mx-auto w-full px-4 tablet-up:px-8">
      <div className="text-center">
        <h1 className="font-display text-[32px] font-normal leading-[32px] tracking-[-1.92px] text-text-heading desktop:text-[64px] desktop:leading-[100%] desktop:tracking-[-0.06em]">
          Create stunning{' '}
          <span className="bg-gradient-to-r from-[#ec4899] to-appweaver-orange bg-clip-text text-transparent">
            designs
          </span>{' '}
          with AI
        </h1>

        <div className="mx-auto mt-8 w-full max-w-hero-category desktop:max-w-hero-prompt-desktop">
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
            openAttachmentDialogSignal={attachmentSignal}
          />
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-hero-prompt-tablet flex-wrap items-center justify-center gap-2">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => handleQuickAction(action.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-app-border-subtle bg-white px-3.5 text-sm text-text-secondary transition-colors hover:bg-black/[0.03]">
              <action.icon className="h-4 w-4 shrink-0" />
              {action.label}
              {action.comingSoon ? (
                <span className="text-xs text-text-muted">(Soon)</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 15 15 9M10 6l1.5-1.5a3.5 3.5 0 1 1 5 5L15 11M14 18l-1.5 1.5a3.5 3.5 0 1 1-5-5L9 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FigmaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3h6a3 3 0 0 1 0 6H9a3 3 0 0 1 0-6Zm0 6h6a3 3 0 0 1 0 6H9m0-6a3 3 0 1 0 3 3V9a3 3 0 1 0-3 3Zm0 6a3 3 0 1 0 3 3v-3H9Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5 17l4.5-4.5a2 2 0 0 1 2.8 0L15 15.5m1-1.5.5-.5a2 2 0 0 1 2.8 0l1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwatchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4.5h9a2.5 2.5 0 0 1 2.5 2.5v9A6.5 6.5 0 0 1 11 22.5H6A2.5 2.5 0 0 1 3.5 20V7A2.5 2.5 0 0 1 6 4.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="14" r="1.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

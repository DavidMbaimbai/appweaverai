import {
  clearHeroPromptAttachments,
  saveHeroPromptAttachments,
} from './hero-prompt-attachments';
import { PromptAttachment } from './prompt-attachments';

const STORAGE_KEY = 'appweaver-hero-prompt-draft';

export type HeroPromptDraft = {
  value: string;
  categoryId: string | null;
  planMode: boolean;
  autostart: boolean;
  websiteType?: string | null;
  codingLanguage?: string | null;
};

export function saveHeroPromptDraft(draft: HeroPromptDraft) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function loadHeroPromptDraft(): HeroPromptDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HeroPromptDraft>;
    if (typeof parsed.value !== 'string') return null;

    return {
      value: parsed.value,
      categoryId:
        typeof parsed.categoryId === 'string' ? parsed.categoryId : null,
      planMode: Boolean(parsed.planMode),
      autostart: Boolean(parsed.autostart),
      websiteType:
        typeof parsed.websiteType === 'string' ? parsed.websiteType : null,
      codingLanguage:
        typeof parsed.codingLanguage === 'string'
          ? parsed.codingLanguage
          : null,
    };
  } catch {
    return null;
  }
}

export function clearHeroPromptDraft() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function persistHeroPromptState({
  value,
  categoryId,
  planMode,
  attachments,
  autostart = false,
  websiteType = null,
  codingLanguage = null,
}: {
  value: string;
  categoryId: string | null;
  planMode: boolean;
  attachments: PromptAttachment[];
  autostart?: boolean;
  websiteType?: string | null;
  codingLanguage?: string | null;
}) {
  saveHeroPromptDraft({
    value,
    categoryId,
    planMode,
    autostart,
    websiteType,
    codingLanguage,
  });
  await saveHeroPromptAttachments(attachments);
}

export function buildProjectFormData({
  prompt,
  planMode,
  categoryId,
  websiteType,
  codingLanguage,
  attachments,
}: {
  prompt: string;
  planMode: boolean;
  categoryId?: string | null;
  websiteType?: string | null;
  codingLanguage?: string | null;
  attachments: PromptAttachment[];
}) {
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('planMode', planMode ? 'true' : 'false');

  if (categoryId) {
    formData.append('categoryId', categoryId);
  }
  if (websiteType) {
    formData.append('websiteType', websiteType);
  }
  if (codingLanguage) {
    formData.append('codingLanguage', codingLanguage);
  }

  attachments.forEach((attachment, index) => {
    formData.append(`attachment-${index}`, attachment.file);
  });

  return formData;
}

export async function clearHeroPromptState() {
  clearHeroPromptDraft();
  await clearHeroPromptAttachments();
}

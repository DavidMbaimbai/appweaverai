'use server';

import { redirect } from 'next/navigation';
import { getCachedSession } from '../auth/cached';
import { rateLimit } from '../rate-limit';
import { withCredits } from '../credits/with-credits';
import { fetchFigmaDesign } from '../design-import/figma';
import { fetchWebsiteDesign } from '../design-import/url';
import { captureWebsiteReference } from '../design-import/browser-capture';
import { designSpecToPrompt, screenshotPrompt } from '../design-import/to-prompt';
import type { ReferenceContext } from '../design-import/types';
import { createProjectAction } from './projects';

export type DesignImportResult = { error: string };

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMPORT_RATE_LIMIT = 10;
const IMPORT_RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_NOTES_LENGTH = 2000;

async function requireUser() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/?auth=login&callbackUrl=/import');
  const limit = await rateLimit(`design-import:${userId}`, IMPORT_RATE_LIMIT, IMPORT_RATE_WINDOW_MS);
  if (!limit.ok) {
    return {
      userId,
      error: `Too many imports. Try again in ${limit.retryAfter}s.`,
    };
  }
  return { userId, error: null };
}

async function createFromPrompt(
  prompt: string,
  planMode: boolean,
  options: { referenceContext?: ReferenceContext; attachment?: File } = {},
): Promise<DesignImportResult | undefined> {
  const form = new FormData();
  form.set('prompt', prompt);
  form.set('planMode', planMode ? 'true' : 'false');
  if (options.referenceContext) {
    form.set('referenceContext', JSON.stringify(options.referenceContext));
  }
  if (options.attachment) {
    form.set('attachment-0', options.attachment);
  }
  const result = await createProjectAction(form);
  return result ?? undefined;
}

async function importFigma(
  formData: FormData,
  notes: string,
  planMode: boolean,
): Promise<DesignImportResult | undefined> {
  const url = String(formData.get('figmaUrl') ?? '');
  const token = String(formData.get('figmaToken') ?? '').trim();
  if (!token) return { error: 'Enter your Figma personal access token.' };
  // The token is used for these API calls only and is never stored or logged.
  const spec = await fetchFigmaDesign(url, token);
  if (spec.frames.length === 0) {
    return { error: 'No frames found. Link to a specific frame or a file with top-level frames.' };
  }
  return createFromPrompt(designSpecToPrompt(spec, notes), planMode);
}

async function importUrl(
  formData: FormData,
  notes: string,
  planMode: boolean,
): Promise<DesignImportResult | undefined> {
  const url = String(formData.get('websiteUrl') ?? '');
  const spec = await captureWebsiteReference(url).catch(() => fetchWebsiteDesign(url));
  return createFromPrompt(designSpecToPrompt(spec, notes), planMode, {
    referenceContext: spec.referenceContext,
  });
}

async function importScreenshot(
  formData: FormData,
  notes: string,
  planMode: boolean,
): Promise<DesignImportResult | undefined> {
  const file = formData.get('screenshot');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a screenshot image.' };
  }
  if (!SCREENSHOT_TYPES.has(file.type)) {
    return { error: 'Screenshot must be a PNG, JPEG, WebP or GIF image.' };
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return { error: 'Screenshot must be 5 MB or smaller.' };
  }
  return createFromPrompt(screenshotPrompt(notes), planMode, { attachment: file });
}

async function runImport(
  formData: FormData,
  kind: string,
  notes: string,
  planMode: boolean,
): Promise<DesignImportResult | undefined> {
  try {
    switch (kind) {
      case 'figma':
        return await importFigma(formData, notes, planMode);
      case 'url':
        return await importUrl(formData, notes, planMode);
      case 'screenshot':
        return await importScreenshot(formData, notes, planMode);
      default:
        return { error: 'Unknown import type.' };
    }
  } catch (error) {
    // redirect() signals via a thrown digest error; let it through.
    if (error instanceof Error && 'digest' in error) throw error;
    return { error: error instanceof Error ? error.message : 'Import failed.' };
  }
}

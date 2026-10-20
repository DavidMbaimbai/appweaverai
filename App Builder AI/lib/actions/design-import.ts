'use server';

import { redirect } from 'next/navigation';
import { getCachedSession } from '../auth/cached';
import { rateLimit } from '../rate-limit';
import { fetchFigmaDesign } from '../design-import/figma';
import { fetchWebsiteDesign } from '../design-import/url';
import { designSpecToPrompt, screenshotPrompt } from '../design-import/to-prompt';
import { createProjectAction } from './projects';

export type DesignImportResult = { error: string };

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

async function requireUser() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/?auth=login&callbackUrl=/import');
  const limit = await rateLimit(`design-import:${userId}`, 10, 10 * 60 * 1000);
  if (!limit.ok) {
    return {
      userId,
      error: `Too many imports. Try again in ${limit.retryAfter}s.`,
    };
  }
  return { userId, error: null };
}

function buildForm(prompt: string, planMode: boolean) {
  const form = new FormData();
  form.set('prompt', prompt);
  form.set('planMode', planMode ? 'true' : 'false');
  return form;
}

export async function importDesignAction(
  formData: FormData,
): Promise<DesignImportResult | undefined> {
  const gate = await requireUser();
  if (gate.error) return { error: gate.error };

  const kind = String(formData.get('kind') ?? '');
  const notes = String(formData.get('notes') ?? '').slice(0, 2000);
  const planMode = formData.get('planMode') === 'true';

  try {
    if (kind === 'figma') {
      const url = String(formData.get('figmaUrl') ?? '');
      const token = String(formData.get('figmaToken') ?? '').trim();
      if (!token) return { error: 'Enter your Figma personal access token.' };
      // The token is used for these API calls only and is never stored or logged.
      const spec = await fetchFigmaDesign(url, token);
      if (spec.frames.length === 0) {
        return { error: 'No frames found. Link to a specific frame or a file with top-level frames.' };
      }
      const result = await createProjectAction(buildForm(designSpecToPrompt(spec, notes), planMode));
      return result ?? undefined;
    }

    if (kind === 'url') {
      const spec = await fetchWebsiteDesign(String(formData.get('websiteUrl') ?? ''));
      const result = await createProjectAction(buildForm(designSpecToPrompt(spec, notes), planMode));
      return result ?? undefined;
    }

    if (kind === 'screenshot') {
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
      const form = buildForm(screenshotPrompt(notes), planMode);
      form.set('attachment-0', file);
      const result = await createProjectAction(form);
      return result ?? undefined;
    }
  } catch (error) {
    // redirect() signals via a thrown digest error; let it through.
    if (error instanceof Error && 'digest' in error) throw error;
    return { error: error instanceof Error ? error.message : 'Import failed.' };
  }

  return { error: 'Unknown import type.' };
}

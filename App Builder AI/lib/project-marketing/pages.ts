import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';

import type { FacebookPage } from './oauth';

export const PAGE_CHOICE_COOKIE = 'pm_fb_pages';
export const PAGE_CHOICE_TTL_SECONDS = 15 * 60;

/** Page tokens stay server-side: the cookie is httpOnly and encrypted. */
export function packPageChoices(pages: FacebookPage[]) {
  return encryptSecret(JSON.stringify(pages.slice(0, 25)));
}

export function unpackPageChoices(value: string | undefined): FacebookPage[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(decryptSecret(value)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is FacebookPage =>
        Boolean(p) && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.access_token === 'string',
    );
  } catch {
    return [];
  }
}

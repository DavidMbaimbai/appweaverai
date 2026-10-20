export const PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TIKTOK', 'X'] as const;
// YOUTUBE exists in the database enum (video releases) but is never a marketing post platform.
export type Platform = (typeof PLATFORMS)[number] | 'YOUTUBE';

/** Platforms with a real publishing API wired up; the rest are copy/export only. */
export const AUTO_PUBLISH_PLATFORMS: Platform[] = ['X', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM'];

export const PLATFORM_LABELS: Record<Platform, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  LINKEDIN: 'LinkedIn',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  X: 'X',
};

export const MAX_TEXT: Record<Platform, number> = {
  X: 280,
  LINKEDIN: 3000,
  FACEBOOK: 5000,
  INSTAGRAM: 2200,
  TIKTOK: 2200,
  YOUTUBE: 5000,
};

/** The exact text that is published or copied: body plus hashtags. */
export function composePostText(text: string, hashtags: string[]) {
  const tags = hashtags.map((t) => `#${t}`).join(' ');
  return tags ? `${text.trim()}\n\n${tags}` : text.trim();
}

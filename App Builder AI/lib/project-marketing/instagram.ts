/**
 * Instagram publishing through the Facebook Graph API (Instagram Business /
 * Creator account linked to the owner's Facebook Page). Pure helpers live here
 * so they can be unit tested; the network calls are in publish.ts.
 */

export const INSTAGRAM_NEEDS_IMAGE =
  'Instagram needs a public https image URL (JPEG). Add one, or copy this post and publish it yourself.';

export const INSTAGRAM_PERMISSION_NOTE =
  'Instagram publishing needs a Business or Creator Instagram account linked to your Facebook Page, and the instagram_basic and instagram_content_publish permissions (Meta app review is required before other users can grant them). Reconnect Facebook after they are approved.';

export function hasInstagramImage(imageUrl: string | null | undefined): imageUrl is string {
  if (!imageUrl) return false;
  try {
    return new URL(imageUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Body for POST /{ig-user-id}/media (step 1 of 2: create the media container). */
export function buildContainerPayload(caption: string, imageUrl: string) {
  return { image_url: imageUrl, caption: caption.slice(0, 2200) };
}

/** Body for POST /{ig-user-id}/media_publish (step 2 of 2). */
export function buildPublishPayload(creationId: string) {
  return { creation_id: creationId };
}

/** Which stored connection carries a platform's token: Instagram uses the Facebook Page token. */
export function connectionPlatform(platform: string) {
  return platform === 'INSTAGRAM' ? 'FACEBOOK' : platform;
}

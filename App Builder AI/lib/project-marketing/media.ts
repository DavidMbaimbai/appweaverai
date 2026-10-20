import { MEDIA_LIMITS } from '@/lib/media-hosting/logic';
import { loadMediaBytes, waitForProcessing, type ProcessingState } from '@/lib/media-hosting/urls';

export type PostMedia = { assetId: string; url: string; contentType: string };
export type MediaStep<T> = { ok: true; value: T } | { ok: false; error: string };

/** Types each platform accepts for a single post image (Instagram only takes JPEG). */
export const IMAGE_TYPES_BY_PLATFORM: Record<string, readonly string[]> = {
  X: ['image/jpeg', 'image/png'],
  LINKEDIN: ['image/jpeg', 'image/png'],
  FACEBOOK: ['image/jpeg', 'image/png'],
  INSTAGRAM: ['image/jpeg'],
};
export const IMAGE_MAX_BYTES = MEDIA_LIMITS.IMAGE.maxBytes;

async function body(response: Response) {
  return (await response.text().catch(() => '')).slice(0, 300);
}

/** X v2 media upload (needs the media.write scope); returns the media id to attach to the tweet. */
export async function uploadXImage(token: string, media: PostMedia, fetchImpl: typeof fetch = fetch): Promise<MediaStep<string>> {
  const file = await loadMediaBytes(media.assetId);
  if (!file) return { ok: false, error: 'The image could not be loaded from storage.' };
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), 'image');
  form.append('media_category', 'tweet_image');
  form.append('media_type', file.contentType);
  const response = await fetchImpl('https://api.x.com/2/media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) return { ok: false, error: `X media upload ${response.status}: ${await body(response)}` };
  const data = (await response.json().catch(() => ({}))) as { data?: { id?: string } };
  return data.data?.id ? { ok: true, value: data.data.id } : { ok: false, error: 'X media upload returned no media id.' };
}

/** LinkedIn Images API: register, upload the bytes, then wait until the image is AVAILABLE. */
export async function uploadLinkedInImage(
  token: string,
  accountId: string,
  media: PostMedia,
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<MediaStep<string>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const file = await loadMediaBytes(media.assetId);
  if (!file) return { ok: false, error: 'The image could not be loaded from storage.' };
  const headers = {
    Authorization: `Bearer ${token}`,
    'Linkedin-Version': process.env.LINKEDIN_API_VERSION ?? '202506',
    'X-Restli-Protocol-Version': '2.0.0',
  };
  const init = await doFetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${accountId}` } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!init.ok) return { ok: false, error: `LinkedIn image init ${init.status}: ${await body(init)}` };
  const value = ((await init.json().catch(() => ({}))) as { value?: { uploadUrl?: string; image?: string } }).value;
  if (!value?.uploadUrl || !value.image) return { ok: false, error: 'LinkedIn returned no upload URL.' };

  const put = await doFetch(value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: headers.Authorization, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(file.bytes),
    signal: AbortSignal.timeout(60_000),
  });
  if (!put.ok) return { ok: false, error: `LinkedIn image upload ${put.status}: ${await body(put)}` };

  const urn = value.image;
  const ready = await waitForProcessing(
    async () => {
      const response = await doFetch(`https://api.linkedin.com/rest/images/${encodeURIComponent(urn)}`, { headers, signal: AbortSignal.timeout(30_000) });
      const status = ((await response.json().catch(() => ({}))) as { status?: string }).status;
      const state: ProcessingState = status === 'AVAILABLE' ? 'FINISHED' : status === 'PROCESSING_FAILED' ? 'ERROR' : 'IN_PROGRESS';
      return { state, detail: status };
    },
    { attempts: 5, baseMs: 500, maxMs: 4000, sleep: opts.sleep },
  );
  return ready.ok ? { ok: true, value: urn } : { ok: false, error: `LinkedIn image: ${ready.error}` };
}

/** Instagram media containers are processed asynchronously; publish only once status_code is FINISHED. */
export function instagramContainerState(statusCode: string | undefined): ProcessingState {
  if (statusCode === 'FINISHED') return 'FINISHED';
  if (statusCode === 'ERROR' || statusCode === 'EXPIRED') return 'ERROR';
  return 'IN_PROGRESS';
}

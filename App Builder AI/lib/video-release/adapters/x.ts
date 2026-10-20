import { HTTP_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, httpFailure, networkFailure, type PublishInput, type PublishResult, type VideoPublisher } from './types';

const API = 'https://api.x.com/2';
const CHUNK = 4 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * X media upload (v2 chunked) followed by a post. Only used when
 * VIDEO_RELEASE_X_AUTO=true, because it needs the media.write scope and an X
 * API plan that allows posting; see capabilities.ts.
 */
export const x: VideoPublisher = {
  platform: 'X',
  async publish(input: PublishInput): Promise<PublishResult> {
    const auth = { Authorization: `Bearer ${input.token}` };
    let mediaId: string;
    try {
      const init = await fetch(`${API}/media/upload/initialize`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'video/mp4', total_bytes: input.sizeBytes, media_category: 'tweet_video' }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!init.ok) return httpFailure(init, 'X');
      const data = (await init.json().catch(() => ({}))) as { data?: { id?: string } };
      if (!data.data?.id) return { ok: false, error: 'X returned no media id.', retryable: true };
      mediaId = data.data.id;

      const bytes = await input.getBytes();
      for (let i = 0, offset = 0; offset < bytes.length; i++, offset += CHUNK) {
        const form = new FormData();
        form.set('segment_index', String(i));
        form.set('media', new Blob([new Uint8Array(bytes.subarray(offset, offset + CHUNK))], { type: 'video/mp4' }));
        const append = await fetch(`${API}/media/upload/${mediaId}/append`, {
          method: 'POST',
          headers: auth,
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (!append.ok) return httpFailure(append, 'X upload');
      }

      const finalize = await fetch(`${API}/media/upload/${mediaId}/finalize`, {
        method: 'POST',
        headers: auth,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!finalize.ok) return httpFailure(finalize, 'X finalize');
      let info = ((await finalize.json().catch(() => ({}))) as { data?: { processing_info?: { state?: string; check_after_secs?: number } } })
        .data?.processing_info;
      for (let i = 0; i < 15 && info && info.state !== 'succeeded'; i++) {
        if (info.state === 'failed') return { ok: false, error: 'X could not process the video.', retryable: false };
        await sleep(Math.min(Math.max(info.check_after_secs ?? 3, 1), 10) * 1000);
        const status = await fetch(`${API}/media/upload?command=STATUS&media_id=${mediaId}`, {
          headers: auth,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!status.ok) return httpFailure(status, 'X status');
        info = ((await status.json().catch(() => ({}))) as { data?: { processing_info?: typeof info } }).data?.processing_info;
      }
      if (info && info.state !== 'succeeded') return { ok: false, error: 'X is still processing the video; will retry.', retryable: true };
    } catch (error) {
      return networkFailure('X', error);
    }

    try {
      const response = await fetch(`${API}/tweets`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text, media: { media_ids: [mediaId] } }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) return httpFailure(response, 'X post');
      const data = (await response.json().catch(() => ({}))) as { data?: { id?: string } };
      if (!data.data?.id) return { ok: false, error: 'X returned no post id.', retryable: false, ambiguous: true };
      return { ok: true, externalId: data.data.id, postUrl: `https://x.com/i/status/${data.data.id}` };
    } catch (error) {
      return networkFailure('X post', error, true);
    }
  },
};

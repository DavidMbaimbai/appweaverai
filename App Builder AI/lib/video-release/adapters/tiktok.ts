import { HTTP_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, httpFailure, networkFailure, type PublishInput, type PublishResult, type VideoPublisher } from './types';

const API = 'https://open.tiktokapis.com/v2';
const SINGLE_CHUNK_MAX = 64 * 1024 * 1024;
const CHUNK = 32 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chunk plan per TikTok rules: one chunk up to 64 MB, else equal chunks with the last absorbing the remainder. */
export function planChunks(size: number): { chunkSize: number; count: number } {
  if (size <= SINGLE_CHUNK_MAX) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };

/**
 * TikTok Content Posting API (Direct Post, FILE_UPLOAD). Unaudited apps may
 * only post with SELF_ONLY privacy, which this adapter enforces and reports.
 */
export const tiktok: VideoPublisher = {
  platform: 'TIKTOK',
  async publish(input: PublishInput): Promise<PublishResult> {
    const headers = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json; charset=UTF-8' };
    let publishId: string;
    let uploadUrl: string;
    const { chunkSize, count } = planChunks(input.sizeBytes);
    try {
      let privacy = 'SELF_ONLY';
      if (!input.privateOnly) {
        const creator = await fetch(`${API}/post/publish/creator_info/query/`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!creator.ok) return httpFailure(creator, 'TikTok');
        const info = (await creator.json().catch(() => ({}))) as Envelope<{ privacy_level_options?: string[] }>;
        const options = info.data?.privacy_level_options ?? [];
        privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : (options[0] ?? 'SELF_ONLY');
      }
      const init = await fetch(`${API}/post/publish/video/init/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          post_info: { title: input.text.slice(0, 2200), privacy_level: privacy, is_aigc: true },
          source_info: { source: 'FILE_UPLOAD', video_size: input.sizeBytes, chunk_size: chunkSize, total_chunk_count: count },
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!init.ok) return httpFailure(init, 'TikTok');
      const data = (await init.json().catch(() => ({}))) as Envelope<{ publish_id?: string; upload_url?: string }>;
      if (!data.data?.publish_id || !data.data.upload_url) {
        return { ok: false, error: `TikTok returned no upload session${data.error?.message ? `: ${data.error.message}` : ''}.`, retryable: true };
      }
      publishId = data.data.publish_id;
      uploadUrl = data.data.upload_url;
    } catch (error) {
      return networkFailure('TikTok', error);
    }

    try {
      const bytes = await input.getBytes();
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? bytes.length : start + chunkSize;
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}`,
            'Content-Length': String(end - start),
          },
          body: new Uint8Array(bytes.subarray(start, end)),
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (!response.ok && response.status !== 206) return httpFailure(response, 'TikTok upload');
      }
    } catch (error) {
      return networkFailure('TikTok upload', error);
    }

    try {
      for (let i = 0; i < 20; i++) {
        await sleep(3000);
        const response = await fetch(`${API}/post/publish/status/fetch/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ publish_id: publishId }),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!response.ok) return httpFailure(response, 'TikTok status');
        const data = (await response.json().catch(() => ({}))) as Envelope<{
          status?: string;
          fail_reason?: string;
          publicaly_available_post_id?: string[];
        }>;
        const status = data.data?.status;
        if (status === 'FAILED') {
          return { ok: false, error: `TikTok rejected the video: ${data.data?.fail_reason ?? 'unknown reason'}.`, retryable: false };
        }
        if (status === 'PUBLISH_COMPLETE') {
          return {
            ok: true,
            externalId: data.data?.publicaly_available_post_id?.[0] ?? publishId,
            postUrl: null,
            note: input.privateOnly
              ? 'Posted as PRIVATE (only you can see it). TikTok only allows public posting from audited apps; publish it from the TikTok app if you want it public.'
              : undefined,
          };
        }
      }
      return {
        ok: false,
        error: `TikTok has not confirmed the post (publish id ${publishId}). Check the TikTok app before retrying.`,
        retryable: false,
        ambiguous: true,
      };
    } catch (error) {
      return networkFailure('TikTok status', error, true);
    }
  },
};

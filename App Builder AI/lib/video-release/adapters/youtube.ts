import { HTTP_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, httpFailure, networkFailure, type PublishInput, type PublishResult, type VideoPublisher } from './types';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

/** YouTube Data API v3 resumable upload (scope youtube.upload). */
export const youtube: VideoPublisher = {
  platform: 'YOUTUBE',
  async publish(input: PublishInput): Promise<PublishResult> {
    let location: string | null;
    try {
      const init = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(input.sizeBytes),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: { title: input.title.slice(0, 100), description: input.text, categoryId: '22' },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
            containsSyntheticMedia: true,
          },
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!init.ok) return httpFailure(init, 'YouTube');
      location = init.headers.get('location');
    } catch (error) {
      return networkFailure('YouTube', error);
    }
    if (!location) return { ok: false, error: 'YouTube returned no upload session.', retryable: true };

    let bytes: Buffer;
    try {
      bytes = await input.getBytes();
    } catch (error) {
      return networkFailure('Reading the video', error);
    }

    try {
      const upload = await fetch(location, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!upload.ok) return httpFailure(upload, 'YouTube upload');
      const data = (await upload.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string } };
      if (!data.id) {
        return { ok: false, error: 'YouTube did not return a video id.', retryable: false, ambiguous: true };
      }
      return {
        ok: true,
        externalId: data.id,
        postUrl: `https://www.youtube.com/watch?v=${data.id}`,
        note:
          data.status?.privacyStatus && data.status.privacyStatus !== 'public'
            ? `YouTube set the video to ${data.status.privacyStatus}. Unaudited API projects can only upload private videos; change it in YouTube Studio.`
            : undefined,
      };
    } catch (error) {
      // The bytes may have been accepted even though the response was lost.
      return networkFailure('YouTube upload', error, true);
    }
  },
};

/** Real view counts from videos.list; the only metric this app reports. */
export async function fetchYoutubeMetrics(token: string, videoId: string): Promise<{ views: number } | null> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'statistics');
  url.searchParams.set('id', videoId);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { items?: { statistics?: { viewCount?: string } }[] };
  const views = Number(data.items?.[0]?.statistics?.viewCount);
  return Number.isFinite(views) ? { views } : null;
}

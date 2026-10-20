import { UPLOAD_TIMEOUT_MS, networkFailure, type PublishInput, type PublishResult, type VideoPublisher } from './types';

/** Graph error code 190 / OAuthException: the Page token is expired or revoked. */
export function graphFailure(error: unknown, label: string): PublishResult {
  const message = error instanceof Error ? error.message : String(error);
  const authExpired = /OAuthException|access token|session has expired|\(#190\)/i.test(message);
  return { ok: false, error: `${label}: ${message.slice(0, 250)}`, retryable: !authExpired, authExpired };
}

/** Facebook Page video: Facebook pulls the file from a short-lived presigned URL. */
export const facebook: VideoPublisher = {
  platform: 'FACEBOOK',
  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accountId) {
      return { ok: false, error: 'Facebook Page id is missing. Reconnect Facebook.', retryable: false, authExpired: true };
    }
    try {
      const form = new URLSearchParams({
        file_url: await input.getPublicUrl(60 * 60),
        title: input.title.slice(0, 255),
        description: input.text,
        access_token: input.token,
      });
      const response = await fetch(`https://graph-video.facebook.com/v21.0/${input.accountId}/videos`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!response.ok || data.error) return graphFailure(new Error(data.error?.message ?? `HTTP ${response.status}`), 'Facebook');
      if (!data.id) return { ok: false, error: 'Facebook returned no video id.', retryable: false, ambiguous: true };
      return { ok: true, externalId: data.id, postUrl: `https://www.facebook.com/${data.id}` };
    } catch (error) {
      return networkFailure('Facebook', error, true);
    }
  },
};

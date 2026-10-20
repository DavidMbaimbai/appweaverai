import { HTTP_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, httpFailure, networkFailure, type PublishInput, type PublishResult, type VideoPublisher } from './types';

const API = 'https://api.linkedin.com/rest';

/** LinkedIn "little text" treats these characters as markup. */
function escapeLinkedIn(text: string) {
  return text.replace(/[\\(){}[\]<>@|~_*]/g, (c) => `\\${c}`);
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'Linkedin-Version': process.env.LINKEDIN_API_VERSION ?? '202506',
  'X-Restli-Protocol-Version': '2.0.0',
});

type Instruction = { firstByte: number; lastByte: number; uploadUrl: string };

/** LinkedIn member video: initializeUpload, upload the parts, finalizeUpload, then create the post. */
export const linkedin: VideoPublisher = {
  platform: 'LINKEDIN',
  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accountId) {
      return { ok: false, error: 'LinkedIn member id is missing. Reconnect LinkedIn.', retryable: false, authExpired: true };
    }
    const owner = `urn:li:person:${input.accountId}`;
    let video: string;
    let uploadToken = '';
    let instructions: Instruction[];
    try {
      const init = await fetch(`${API}/videos?action=initializeUpload`, {
        method: 'POST',
        headers: headers(input.token),
        body: JSON.stringify({
          initializeUploadRequest: { owner, fileSizeBytes: input.sizeBytes, uploadCaptions: false, uploadThumbnail: false },
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!init.ok) return httpFailure(init, 'LinkedIn');
      const data = (await init.json().catch(() => ({}))) as {
        value?: { video?: string; uploadToken?: string; uploadInstructions?: Instruction[] };
      };
      if (!data.value?.video || !data.value.uploadInstructions?.length) {
        return { ok: false, error: 'LinkedIn returned no upload session.', retryable: true };
      }
      video = data.value.video;
      uploadToken = data.value.uploadToken ?? '';
      instructions = data.value.uploadInstructions;
    } catch (error) {
      return networkFailure('LinkedIn', error);
    }

    try {
      const bytes = await input.getBytes();
      const partIds: string[] = [];
      for (const part of instructions) {
        const response = await fetch(part.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(bytes.subarray(part.firstByte, part.lastByte + 1)),
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (!response.ok) return httpFailure(response, 'LinkedIn upload');
        const etag = response.headers.get('etag');
        if (!etag) return { ok: false, error: 'LinkedIn returned no part id.', retryable: true };
        partIds.push(etag);
      }
      const finalize = await fetch(`${API}/videos?action=finalizeUpload`, {
        method: 'POST',
        headers: headers(input.token),
        body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds: partIds } }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!finalize.ok) return httpFailure(finalize, 'LinkedIn finalize');
    } catch (error) {
      // Nothing is posted until the final call, so a failed upload can be retried safely.
      return networkFailure('LinkedIn upload', error);
    }

    try {
      const response = await fetch(`${API}/posts`, {
        method: 'POST',
        headers: headers(input.token),
        body: JSON.stringify({
          author: owner,
          commentary: escapeLinkedIn(input.text),
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          content: { media: { title: input.title.slice(0, 100), id: video } },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) return httpFailure(response, 'LinkedIn post');
      const id = response.headers.get('x-restli-id');
      if (!id) return { ok: false, error: 'LinkedIn returned no post id.', retryable: false, ambiguous: true };
      return { ok: true, externalId: id, postUrl: `https://www.linkedin.com/feed/update/${id}/` };
    } catch (error) {
      return networkFailure('LinkedIn post', error, true);
    }
  },
};

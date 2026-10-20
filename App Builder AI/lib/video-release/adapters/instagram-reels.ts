import { graph } from '@/lib/ads/meta';

import { graphFailure } from './facebook';
import type { PublishInput, PublishResult, VideoPublisher } from './types';

type IgAccount = { instagram_business_account?: { id?: string } };
type IgStatus = { status_code?: string; status?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Instagram Reel through the Graph API container flow, using the Facebook Page token. */
export const instagramReels: VideoPublisher = {
  platform: 'INSTAGRAM',
  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accountId) {
      return { ok: false, error: 'Facebook Page id is missing. Reconnect Facebook.', retryable: false, authExpired: true };
    }
    try {
      const account = await graph<IgAccount>(`${input.accountId}?fields=instagram_business_account`, undefined, input.token);
      const igId = account.instagram_business_account?.id;
      if (!igId) {
        return { ok: false, error: 'No Instagram Business or Creator account is linked to your Facebook Page.', retryable: false };
      }
      const container = await graph<{ id?: string }>(
        `${igId}/media`,
        {
          media_type: 'REELS',
          video_url: await input.getPublicUrl(60 * 60),
          caption: input.text.slice(0, 2200),
          share_to_feed: true,
        },
        input.token,
      );
      if (!container.id) return { ok: false, error: 'Instagram returned no media container.', retryable: true };

      let finished = false;
      for (let i = 0; i < 20 && !finished; i++) {
        await sleep(3000);
        const state = await graph<IgStatus>(`${container.id}?fields=status_code,status`, undefined, input.token);
        if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') {
          return { ok: false, error: `Instagram could not process the video: ${state.status ?? state.status_code}.`, retryable: false };
        }
        finished = state.status_code === 'FINISHED';
      }
      if (!finished) return { ok: false, error: 'Instagram is still processing the video; will retry.', retryable: true };

      const published = await graph<{ id?: string }>(`${igId}/media_publish`, { creation_id: container.id }, input.token);
      if (!published.id) return { ok: false, error: 'Instagram returned no media id.', retryable: false, ambiguous: true };
      const link = await graph<{ permalink?: string }>(`${published.id}?fields=permalink`, undefined, input.token).catch(
        (): { permalink?: string } => ({}),
      );
      return { ok: true, externalId: published.id, postUrl: link.permalink ?? null };
    } catch (error) {
      return graphFailure(error, 'Instagram');
    }
  },
};

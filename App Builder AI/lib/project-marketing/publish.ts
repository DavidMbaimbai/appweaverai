import { graph } from '@/lib/ads/meta';
import { sendAlert } from '@/lib/alerts';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import { finishScheduledSlot, holdScheduledSlot } from '@/lib/marketing-credits/run';

import {
  campaignStatus,
  composePostText,
  isAutoPublishPlatform,
  selectDuePosts,
  type Platform,
} from './logic';
import { refreshXToken } from './oauth';
import {
  buildContainerPayload,
  buildPublishPayload,
  connectionPlatform,
  hasInstagramImage,
  INSTAGRAM_NEEDS_IMAGE,
  INSTAGRAM_PERMISSION_NOTE,
} from './instagram';

export type SendInput = {
  text: string;
  imageUrl: string | null;
  token: string;
  accountId: string | null;
};
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

const MAX_PER_RUN = 20;

/** Set PROJECT_MARKETING_DRY_RUN=true to log what would be posted without calling any platform. */
export function isDryRun() {
  return process.env.PROJECT_MARKETING_DRY_RUN === 'true';
}

async function failure(response: Response, label: string): Promise<SendResult> {
  const body = (await response.text().catch(() => '')).slice(0, 300);
  return { ok: false, error: `${label} ${response.status}: ${body}` };
}

async function sendX({ text, token }: SendInput): Promise<SendResult> {
  const response = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return failure(response, 'X');
  const data = (await response.json().catch(() => ({}))) as { data?: { id?: string } };
  return data.data?.id ? { ok: true, id: data.data.id } : { ok: false, error: 'X returned no post id.' };
}

/** LinkedIn "little text" treats these characters as markup. */
export function escapeLinkedIn(text: string) {
  return text.replace(/[\\(){}[\]<>@|~_*]/g, (c) => `\\${c}`);
}

async function sendLinkedIn({ text, token, accountId }: SendInput): Promise<SendResult> {
  if (!accountId) return { ok: false, error: 'LinkedIn member id is missing. Reconnect LinkedIn.' };
  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Linkedin-Version': process.env.LINKEDIN_API_VERSION ?? '202506',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${accountId}`,
      commentary: escapeLinkedIn(text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return failure(response, 'LinkedIn');
  return { ok: true, id: response.headers.get('x-restli-id') ?? 'published' };
}

async function sendFacebook({ text, imageUrl, token, accountId }: SendInput): Promise<SendResult> {
  if (!accountId) return { ok: false, error: 'Facebook Page id is missing. Reconnect Facebook.' };
  try {
    const data = imageUrl
      ? await graph<{ post_id?: string; id?: string }>(`${accountId}/photos`, { url: imageUrl, caption: text }, token)
      : await graph<{ post_id?: string; id?: string }>(`${accountId}/feed`, { message: text }, token);
    const id = data.post_id ?? data.id;
    return id ? { ok: true, id } : { ok: false, error: 'Facebook returned no post id.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendInstagram({ text, imageUrl, token, accountId }: SendInput): Promise<SendResult> {
  if (!accountId) return { ok: false, error: 'Facebook Page id is missing. Reconnect Facebook.' };
  if (!hasInstagramImage(imageUrl)) return { ok: false, error: INSTAGRAM_NEEDS_IMAGE };
  try {
    const page = await graph<{ instagram_business_account?: { id?: string } }>(
      `${accountId}?fields=instagram_business_account`,
      undefined,
      token,
    );
    const igId = page.instagram_business_account?.id;
    if (!igId) {
      return { ok: false, error: `No Instagram Business account is linked to this Facebook Page. ${INSTAGRAM_PERMISSION_NOTE}` };
    }
    const container = await graph<{ id?: string }>(`${igId}/media`, buildContainerPayload(text, imageUrl), token);
    if (!container.id) return { ok: false, error: 'Instagram returned no media container.' };
    const published = await graph<{ id?: string }>(`${igId}/media_publish`, buildPublishPayload(container.id), token);
    return published.id ? { ok: true, id: published.id } : { ok: false, error: 'Instagram returned no post id.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /permission|OAuth|\(#10\)|\(#200\)/i.test(message) ? `${message} ${INSTAGRAM_PERMISSION_NOTE}` : message };
  }
}

export const SENDERS: Partial<Record<Platform, (input: SendInput) => Promise<SendResult>>> = {
  X: sendX,
  LINKEDIN: sendLinkedIn,
  FACEBOOK: sendFacebook,
  INSTAGRAM: sendInstagram,
};

/** Returns a usable access token, refreshing X tokens that are about to expire. */
async function usableToken(connection: {
  id: string;
  platform: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
}): Promise<string | null> {
  const expiresSoon = connection.expiresAt && connection.expiresAt.getTime() < Date.now() + 5 * 60_000;
  if (!expiresSoon) return decryptSecret(connection.accessTokenEnc);
  if (connection.platform === 'X' && connection.refreshTokenEnc) {
    const next = await refreshXToken(decryptSecret(connection.refreshTokenEnc));
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptSecret(next.accessToken),
        refreshTokenEnc: next.refreshToken ? encryptSecret(next.refreshToken) : null,
        expiresAt: next.expiresAt,
      },
    });
    return next.accessToken;
  }
  return null;
}

export async function syncCampaignStatus(campaignId: string) {
  const posts = await prisma.projectPost.findMany({ where: { campaignId }, select: { status: true } });
  await prisma.projectCampaign.update({
    where: { id: campaignId },
    data: { status: campaignStatus(posts.map((p) => p.status)) },
  });
}

/** Publishes due, explicitly approved posts through each owner's own connection. */
export async function publishDueProjectPosts(now = new Date()) {
  const candidates = await prisma.projectPost.findMany({
    where: { status: { in: ['APPROVED', 'SCHEDULED'] }, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: MAX_PER_RUN * 3,
    include: { campaign: { select: { userId: true, projectId: true } } },
  });
  const { due, stale } = selectDuePosts(candidates, now);
  const touched = new Set<string>();
  const held: Array<{ id: string; key: string }> = [];
  const summary = { published: 0, manual: 0, failed: 0, paused: 0, stale: stale.length, dryRun: isDryRun() };

  for (const post of stale) {
    await prisma.projectPost.update({
      where: { id: post.id },
      data: { status: 'FAILED', error: 'Missed its scheduled time by more than 48 hours. Reschedule and approve again.' },
    });
    touched.add(post.campaignId);
  }

  for (const post of due.slice(0, MAX_PER_RUN)) {
    const platform = post.platform as Platform;
    const text = composePostText(post.text, post.hashtags);
    if (isDryRun()) {
      console.info(`[project-posts] DRY RUN ${platform} post ${post.id}: ${text.slice(0, 120)}`);
      continue;
    }

    // Billable schedules check budget and balance first; when reached the post stays queued and the owner is told.
    const slot = await holdScheduledSlot({
      userId: post.campaign.userId,
      projectId: post.campaign.projectId,
      operation: 'publish_post',
      slot: post.scheduledAt?.toISOString() ?? 'unscheduled',
      jobId: `post:${post.id}`,
    });
    if (!slot.ok) {
      if (slot.reason === 'duplicate') continue;
      summary.paused++;
      break;
    }
    if (slot.key) held.push({ id: post.id, key: slot.key });

    // Claim first so overlapping cron runs cannot publish the same post twice.
    const claim = await prisma.projectPost.updateMany({
      where: { id: post.id, status: { in: ['APPROVED', 'SCHEDULED'] } },
      data: { status: 'PUBLISHING' },
    });
    if (claim.count === 0) continue;
    touched.add(post.campaignId);

    try {
      const connection = isAutoPublishPlatform(platform)
        ? await prisma.socialConnection.findUnique({
            where: {
              userId_platform: {
                userId: post.campaign.userId,
                platform: connectionPlatform(post.platform) as 'X' | 'LINKEDIN' | 'FACEBOOK',
              },
            },
          })
        : null;
      if (platform === 'INSTAGRAM' && !hasInstagramImage(post.imageUrl)) {
        await prisma.projectPost.update({
          where: { id: post.id },
          data: { status: 'MANUAL', error: INSTAGRAM_NEEDS_IMAGE },
        });
        summary.manual++;
        continue;
      }
      const token = connection ? await usableToken(connection) : null;
      const send = SENDERS[platform];
      if (!connection || !token || !send) {
        await prisma.projectPost.update({
          where: { id: post.id },
          data: {
            status: 'MANUAL',
            error: connection ? 'Connection expired. Reconnect, or post manually.' : 'Not connected. Copy and post manually.',
          },
        });
        summary.manual++;
        continue;
      }
      const result = await send({ text, imageUrl: post.imageUrl, token, accountId: connection.accountId });
      if (result.ok) {
        await prisma.projectPost.update({
          where: { id: post.id },
          data: { status: 'PUBLISHED', externalId: result.id, publishedAt: new Date(), error: null },
        });
        summary.published++;
      } else {
        await prisma.projectPost.update({ where: { id: post.id }, data: { status: 'FAILED', error: result.error } });
        summary.failed++;
      }
    } catch (error) {
      console.error('[project-posts] publish failed:', error);
      await prisma.projectPost.update({
        where: { id: post.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error' },
      });
      summary.failed++;
    }
  }

  if (held.length > 0) {
    const rows = await prisma.projectPost.findMany({ where: { id: { in: held.map((h) => h.id) } }, select: { id: true, status: true } });
    const status = new Map(rows.map((r) => [r.id, r.status]));
    for (const h of held) {
      await finishScheduledSlot(h.key, 'publish_post', status.get(h.id) === 'PUBLISHED').catch((e) =>
        console.error('[project-posts] credit settle failed:', e),
      );
    }
  }
  for (const id of touched) await syncCampaignStatus(id);
  if (summary.failed > 0) await sendAlert('Project posts failed', JSON.stringify(summary));
  return summary;
}

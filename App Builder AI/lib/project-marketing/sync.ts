/**
 * lib/project-marketing/sync.ts
 *
 * Cron job to fetch impressions, likes, and clicks from social platform APIs.
 */
import { prisma } from '@/lib/prisma';
import { graph } from '@/lib/ads/meta';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { refreshXToken } from './oauth';
import { type Platform } from './logic';

export async function syncMarketingPostMetrics() {
  const activePosts = await prisma.projectPost.findMany({
    where: {
      status: 'PUBLISHED',
      externalId: { not: null },
      publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
    },
    include: {
      campaign: true
    }
  });

  for (const post of activePosts) {
    try {
      const platform = post.platform as Platform;
      const connection = await prisma.socialConnection.findUnique({
        where: {
          userId_platform: {
            userId: post.campaign.userId,
            platform: platform === 'INSTAGRAM' || platform === 'FACEBOOK' ? 'FACEBOOK' : platform
          }
        }
      });

      if (!connection) continue;

      const token = await getValidToken(connection);
      if (!token) continue;

      let metrics: { impressions: number; likes: number; shares: number; comments: number } | null = null;

      if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {
        metrics = await fetchMetaMetrics(post.externalId!, token, platform);
      } else if (platform === 'X') {
        metrics = await fetchXMetrics(post.externalId!, token);
      } else if (platform === 'LINKEDIN') {
        metrics = await fetchLinkedInMetrics(post.externalId!, token);
      }

      if (metrics) {
        await prisma.marketingPostMetrics.upsert({
          where: { postId: post.id },
          create: {
            postId: post.id,
            impressions: metrics.impressions,
            likes: metrics.likes,
            shares: metrics.shares,
            comments: metrics.comments,
            lastSyncedAt: new Date(),
          },
          update: {
            impressions: metrics.impressions,
            likes: metrics.likes,
            shares: metrics.shares,
            comments: metrics.comments,
            lastSyncedAt: new Date(),
          },
        });
      }
    } catch (error) {
      console.error(`[marketing-sync] failed for post ${post.id}:`, error);
    }
  }
}

interface SocialConnectionLike {
  id: string;
  platform: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
}

async function getValidToken(connection: SocialConnectionLike): Promise<string | null> {
  const expiresSoon = connection.expiresAt && connection.expiresAt.getTime() < Date.now() + 5 * 60_000;
  if (!expiresSoon) return decryptSecret(connection.accessTokenEnc);
  
  if (connection.platform === 'X' && connection.refreshTokenEnc) {
    try {
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
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchMetaMetrics(externalId: string, token: string, platform: 'FACEBOOK' | 'INSTAGRAM') {
  const fields = platform === 'FACEBOOK' 
    ? 'insights.metric(post_impressions,post_reactions_by_type_total,post_shares_count,post_comments_count)'
    : 'insights.metric(impressions,reach,replies,saved)';
  
  const data = await graph<{
    insights?: {
      data: Array<{
        name: string;
        values: Array<{ value: number }>;
      }>;
    };
  }>(`${externalId}?fields=${fields}`, undefined, token);
  
  const insights = data.insights?.data || [];
  
  const find = (name: string) => insights.find((i) => i.name === name)?.values?.[0]?.value || 0;

  if (platform === 'FACEBOOK') {
    return {
      impressions: find('post_impressions'),
      likes: find('post_reactions_by_type_total'),
      shares: find('post_shares_count'),
      comments: find('post_comments_count'),
    };
  } else {
    return {
      impressions: find('impressions'),
      likes: find('reach'), // Approximation for IG
      shares: find('saved'), // Approximation
      comments: find('replies'),
    };
  }
}

async function fetchXMetrics(externalId: string, token: string) {
  // Mocking X API call - requires v2 metrics endpoint
  return { impressions: 0, likes: 0, shares: 0, comments: 0 };
}

async function fetchLinkedInMetrics(externalId: string, token: string) {
  // Mocking LinkedIn API call
  return { impressions: 0, likes: 0, shares: 0, comments: 0 };
}

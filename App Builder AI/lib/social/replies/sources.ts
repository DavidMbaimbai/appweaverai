import { createHmac, timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { googleAccessToken } from '@/lib/social/replies/send';
import { ingestInteraction, type IngestInput } from '@/lib/social/replies/process';

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const actual = Buffer.from(header.slice('sha256='.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type MetaPayload = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        item?: string;
        verb?: string;
        comment_id?: string;
        parent_id?: string;
        message?: string;
        from?: { id?: string; name?: string; username?: string };
        id?: string;
        text?: string;
        reviewer_id?: string;
        reviewer_name?: string;
        review_text?: string;
        rating?: number;
        created_time?: number | string;
      };
    }[];
  }[];
};

/** Turns a Meta webhook payload (Page feed comments, Instagram comments) into interactions. */
export function parseMetaWebhook(
  payload: MetaPayload,
  own: { pageId?: string; instagramId?: string },
): IngestInput[] {
  const out: IngestInput[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;

      if (payload.object === 'page' && change.field === 'ratings') {
        // Page recommendations/reviews are stored for a human and never AI-answered.
        if (!v.reviewer_id || v.reviewer_id === own.pageId) continue;
        out.push({
          platform: 'FACEBOOK',
          externalId: `rating:${v.reviewer_id}:${v.created_time ?? entry.changes?.indexOf(change)}`,
          authorHandle: v.reviewer_id,
          authorName: v.reviewer_name,
          text: v.review_text || `${v.rating ?? ''} star review`.trim(),
          isReview: true,
        });
      } else if (payload.object === 'page' && change.field === 'feed') {
        if (v.item !== 'comment' || v.verb !== 'add' || !v.comment_id || !v.message || !v.from?.id) continue;
        if (v.from.id === own.pageId) continue;
        out.push({
          platform: 'FACEBOOK',
          externalId: v.comment_id,
          replyToId: v.parent_id,
          authorHandle: v.from.id,
          authorName: v.from.name,
          text: v.message,
        });
      } else if (payload.object === 'instagram' && change.field === 'comments') {
        if (!v.id || !v.text || !v.from?.id) continue;
        if (v.from.id === own.instagramId) continue;
        out.push({
          platform: 'INSTAGRAM',
          externalId: v.id,
          authorHandle: v.from.username ?? v.from.id,
          text: v.text,
        });
      }
    }
  }
  return out;
}

async function pollX(): Promise<number> {
  const token = process.env.X_USER_ACCESS_TOKEN;
  const userId = process.env.X_USER_ID;
  if (!token || !userId) return 0;

  const latest = await prisma.socialInteraction.findMany({
    where: { platform: 'X' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { externalId: true },
  });
  // Tweet ids are time-ordered snowflakes; the largest is the newest.
  const sinceId = latest
    .map((i) => i.externalId)
    .filter((id) => /^\d+$/.test(id))
    .reduce<string | null>((max, id) => (max === null || BigInt(id) > BigInt(max) ? id : max), null);

  const params = new URLSearchParams({
    max_results: '20',
    expansions: 'author_id',
    'user.fields': 'username,name',
    'tweet.fields': 'conversation_id',
  });
  if (sinceId) params.set('since_id', sinceId);

  const response = await fetch(`https://api.x.com/2/users/${userId}/mentions?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`X mentions: HTTP ${response.status}`);
  const data = (await response.json()) as {
    data?: { id: string; text: string; author_id: string; conversation_id?: string }[];
    includes?: { users?: { id: string; username: string; name?: string }[] };
  };
  const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));

  let count = 0;
  for (const tweet of data.data ?? []) {
    if (tweet.author_id === userId) continue;
    const author = users.get(tweet.author_id);
    const { created } = await ingestInteraction({
      platform: 'X',
      externalId: tweet.id,
      replyToId: tweet.conversation_id,
      authorHandle: author?.username ?? tweet.author_id,
      authorName: author?.name,
      text: tweet.text,
    });
    if (created) count += 1;
  }
  return count;
}

async function pollYouTube(): Promise<number> {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId || !process.env.YOUTUBE_REFRESH_TOKEN) return 0;

  const token = await googleAccessToken();
  const params = new URLSearchParams({
    part: 'snippet',
    allThreadsRelatedToChannelId: channelId,
    order: 'time',
    maxResults: '20',
    textFormat: 'plainText',
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`YouTube comments: HTTP ${response.status}`);
  const data = (await response.json()) as {
    items?: {
      snippet?: {
        videoId?: string;
        topLevelComment?: {
          id: string;
          snippet?: {
            textDisplay?: string;
            authorDisplayName?: string;
            authorChannelId?: { value?: string };
          };
        };
      };
    }[];
  };

  let count = 0;
  for (const item of data.items ?? []) {
    const comment = item.snippet?.topLevelComment;
    const text = comment?.snippet?.textDisplay;
    const authorId = comment?.snippet?.authorChannelId?.value;
    if (!comment || !text || authorId === channelId) continue;
    const { created } = await ingestInteraction({
      platform: 'YOUTUBE',
      externalId: comment.id,
      replyToId: item.snippet?.videoId,
      authorHandle: authorId ?? comment.snippet?.authorDisplayName ?? 'unknown',
      authorName: comment.snippet?.authorDisplayName,
      text,
    });
    if (created) count += 1;
  }
  return count;
}

/** Pulls new mentions/comments from platforms that don't push webhooks. */
export async function pollSocialSources() {
  const out: Record<string, number | string> = {};
  for (const [name, poll] of [['X', pollX], ['YOUTUBE', pollYouTube]] as const) {
    try {
      out[name] = await poll();
    } catch (error) {
      out[name] = `error: ${String(error).slice(0, 120)}`;
    }
  }
  return out;
}

import type { ReplyPlatform } from '@/lib/social/replies/policy';

export type SendResult = { ok: boolean; id?: string; error?: string; stubbed?: boolean };

export type OutboundReply = {
  platform: ReplyPlatform;
  /** Id of the message being answered (tweet, comment, thing fullname, ...). */
  externalId: string;
  /** Parent post/thread id, when the platform needs it. */
  replyToId?: string | null;
  authorHandle: string;
  text: string;
};

async function readError(response: Response) {
  const body = await response.text().catch(() => '');
  return `HTTP ${response.status}: ${body.slice(0, 300)}`;
}

const TIMEOUT = 15_000;

export async function googleAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { access_token: string }).access_token;
}

async function replyX(r: OutboundReply) {
  const response = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.X_USER_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: r.text, reply: { in_reply_to_tweet_id: r.externalId } }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { data?: { id?: string } }).data?.id;
}

async function replyGraph(edge: 'comments' | 'replies', token: string, r: OutboundReply) {
  const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(r.externalId)}/${edge}`, {
    method: 'POST',
    body: new URLSearchParams({ message: r.text, access_token: token }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { id?: string }).id;
}

async function replyLinkedIn(r: OutboundReply) {
  if (!r.replyToId) throw new Error('LinkedIn replies need the post URN (replyToId).');
  const response = await fetch(
    `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(r.replyToId)}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'Linkedin-Version': process.env.LINKEDIN_API_VERSION ?? '202506',
      },
      body: JSON.stringify({
        actor: process.env.LINKEDIN_AUTHOR_URN,
        object: r.replyToId,
        parentComment: r.externalId.startsWith('urn:li:comment') ? r.externalId : undefined,
        message: { text: r.text },
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.headers.get('x-restli-id') ?? undefined;
}

async function replyReddit(r: OutboundReply) {
  const userAgent = process.env.REDDIT_USER_AGENT ?? 'AppWeaverAI/1.0';
  const basic = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`,
  ).toString('base64');
  const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'User-Agent': userAgent },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.REDDIT_REFRESH_TOKEN!,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!tokenResponse.ok) throw new Error(await readError(tokenResponse));
  const { access_token } = (await tokenResponse.json()) as { access_token: string };

  const response = await fetch('https://oauth.reddit.com/api/comment', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': userAgent },
    body: new URLSearchParams({ api_type: 'json', thing_id: r.externalId, text: r.text }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as {
    json?: { errors?: unknown[][]; data?: { things?: { data?: { name?: string } }[] } };
  };
  if (data.json?.errors?.length) throw new Error(`Reddit: ${JSON.stringify(data.json.errors)}`.slice(0, 300));
  return data.json?.data?.things?.[0]?.data?.name;
}

async function replyYouTube(r: OutboundReply) {
  const token = await googleAccessToken();
  const response = await fetch('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { parentId: r.externalId, textOriginal: r.text } }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { id?: string }).id;
}

/** Generic channel: POSTs the reply to your own system, which delivers it. */
async function replyWebhook(r: OutboundReply) {
  const url = process.env.SOCIAL_REPLY_WEBHOOK_URL!;
  const secret = process.env.SOCIAL_REPLY_WEBHOOK_SECRET;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({
      externalId: r.externalId,
      replyToId: r.replyToId,
      authorHandle: r.authorHandle,
      text: r.text,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(await readError(response));
  return undefined;
}

export function isReplyPlatformConfigured(platform: ReplyPlatform) {
  const env = process.env;
  switch (platform) {
    case 'X':
      return Boolean(env.X_USER_ACCESS_TOKEN);
    case 'FACEBOOK':
      return Boolean(env.FACEBOOK_PAGE_ACCESS_TOKEN);
    case 'INSTAGRAM':
      return Boolean(env.INSTAGRAM_ACCESS_TOKEN);
    case 'LINKEDIN':
      return Boolean(env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_AUTHOR_URN);
    case 'REDDIT':
      return Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_REFRESH_TOKEN);
    case 'YOUTUBE':
      return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN);
    case 'OTHER':
      return Boolean(env.SOCIAL_REPLY_WEBHOOK_URL);
  }
}

const SENDERS: Record<ReplyPlatform, (r: OutboundReply) => Promise<string | undefined>> = {
  X: replyX,
  FACEBOOK: (r) => replyGraph('comments', process.env.FACEBOOK_PAGE_ACCESS_TOKEN!, r),
  INSTAGRAM: (r) => replyGraph('replies', process.env.INSTAGRAM_ACCESS_TOKEN!, r),
  LINKEDIN: replyLinkedIn,
  REDDIT: replyReddit,
  YOUTUBE: replyYouTube,
  OTHER: replyWebhook,
};

/**
 * Sends a reply on the originating platform. With SOCIAL_REPLY_DRY_RUN=true
 * nothing is sent: the reply is logged and reported as `stubbed`.
 */
export async function sendSocialReply(reply: OutboundReply): Promise<SendResult> {
  if (process.env.SOCIAL_REPLY_DRY_RUN === 'true') {
    console.info(
      `[social-replies] (dry run) ${reply.platform} reply to @${reply.authorHandle} (${reply.externalId}): ${reply.text.slice(0, 120)}`,
    );
    return { ok: true, id: `dry-run:${reply.platform}:${reply.externalId}`, stubbed: true };
  }
  if (!isReplyPlatformConfigured(reply.platform)) {
    return { ok: false, error: `${reply.platform} credentials are not configured.` };
  }
  try {
    return { ok: true, id: await SENDERS[reply.platform](reply) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

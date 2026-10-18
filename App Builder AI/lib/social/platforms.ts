import { getAnthropicClient } from '@/lib/anthropic';

export type SocialPlatform =
  | 'FACEBOOK'
  | 'X'
  | 'LINKEDIN'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'YOUTUBE';

export const ALL_PLATFORMS: SocialPlatform[] = [
  'FACEBOOK',
  'X',
  'LINKEDIN',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
];

/** Platforms that can only publish video; skipped for text-only posts. */
export const VIDEO_ONLY_PLATFORMS: SocialPlatform[] = [
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
];

export type PlatformResult = { ok: boolean; id?: string; error?: string };

type PostContent = { message: string; videoUrl?: string | null };

const CAPTION_MODEL =
  process.env.BEDROCK_TRANSLATE_MODEL_ID?.trim() ||
  'eu.anthropic.claude-3-5-haiku-20241022-v1:0';

export function isPlatformConfigured(platform: SocialPlatform) {
  switch (platform) {
    case 'FACEBOOK':
      return Boolean(
        process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      );
    case 'X':
      return Boolean(process.env.X_USER_ACCESS_TOKEN);
    case 'LINKEDIN':
      return Boolean(
        process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN,
      );
    case 'INSTAGRAM':
      return Boolean(
        process.env.INSTAGRAM_USER_ID && process.env.INSTAGRAM_ACCESS_TOKEN,
      );
    case 'TIKTOK':
      return Boolean(process.env.TIKTOK_ACCESS_TOKEN);
    case 'YOUTUBE':
      return Boolean(
        process.env.YOUTUBE_CLIENT_ID &&
          process.env.YOUTUBE_CLIENT_SECRET &&
          process.env.YOUTUBE_REFRESH_TOKEN,
      );
  }
}

async function readError(response: Response) {
  const body = await response.text().catch(() => '');
  return `HTTP ${response.status}: ${body.slice(0, 300)}`;
}

async function postFacebook({ message, videoUrl }: PostContent) {
  const page = process.env.FACEBOOK_PAGE_ID!;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
  const base = `https://graph.facebook.com/v21.0/${page}`;

  const body = new URLSearchParams({ access_token: token });
  if (videoUrl) {
    body.set('file_url', videoUrl);
    body.set('description', message);
  } else {
    body.set('message', message);
  }

  const response = await fetch(`${base}/${videoUrl ? 'videos' : 'feed'}`, {
    method: 'POST',
    body,
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as { id?: string };
  return data.id;
}

async function postX({ message, videoUrl }: PostContent) {
  // X video upload requires the chunked media API; the video is linked instead
  // and X renders the preview card.
  const text = videoUrl ? `${message}\n${videoUrl}` : message;
  const response = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.X_USER_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as { data?: { id?: string } };
  return data.data?.id;
}

async function postLinkedIn({ message, videoUrl }: PostContent) {
  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': process.env.LINKEDIN_API_VERSION ?? '202506',
    },
    body: JSON.stringify({
      author: process.env.LINKEDIN_AUTHOR_URN,
      commentary: videoUrl ? `${message}\n\n${videoUrl}` : message,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.headers.get('x-restli-id') ?? undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Instagram Reels via the Graph API: create container, wait, publish. */
async function postInstagram({ message, videoUrl }: PostContent) {
  if (!videoUrl) throw new Error('Instagram requires a video.');
  const user = process.env.INSTAGRAM_USER_ID!;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN!;
  const base = 'https://graph.facebook.com/v21.0';

  const create = await fetch(`${base}/${user}/media`, {
    method: 'POST',
    body: new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: message.slice(0, 2200),
      access_token: token,
    }),
  });
  if (!create.ok) throw new Error(await readError(create));
  const { id: containerId } = (await create.json()) as { id: string };

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(5000);
    const statusResponse = await fetch(
      `${base}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    if (!statusResponse.ok) throw new Error(await readError(statusResponse));
    const { status_code } = (await statusResponse.json()) as {
      status_code?: string;
    };
    if (status_code === 'FINISHED') {
      const publish = await fetch(`${base}/${user}/media_publish`, {
        method: 'POST',
        body: new URLSearchParams({ creation_id: containerId, access_token: token }),
      });
      if (!publish.ok) throw new Error(await readError(publish));
      return ((await publish.json()) as { id?: string }).id;
    }
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Instagram processing ${status_code}.`);
    }
  }
  throw new Error('Instagram processing timed out.');
}

/**
 * TikTok Content Posting API (pull from URL). The video host must be a
 * domain verified in the TikTok developer portal; unaudited apps can only
 * post privately (SELF_ONLY), which is the default here.
 */
async function postTikTok({ message, videoUrl }: PostContent) {
  if (!videoUrl) throw new Error('TikTok requires a video.');
  const response = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: message.slice(0, 2200),
          privacy_level: process.env.TIKTOK_PRIVACY_LEVEL ?? 'SELF_ONLY',
        },
        source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
      }),
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as {
    data?: { publish_id?: string };
    error?: { code?: string; message?: string };
  };
  if (data.error?.code && data.error.code !== 'ok') {
    throw new Error(`TikTok: ${data.error.code} ${data.error.message ?? ''}`.trim());
  }
  return data.data?.publish_id;
}

/** YouTube Data API: refresh token -> resumable upload of the video bytes. */
async function postYouTube({ message, videoUrl }: PostContent) {
  if (!videoUrl) throw new Error('YouTube requires a video.');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenResponse.ok) throw new Error(await readError(tokenResponse));
  const { access_token } = (await tokenResponse.json()) as {
    access_token: string;
  };

  const source = await fetch(videoUrl);
  if (!source.ok) throw new Error(`Could not download video (${source.status}).`);
  const bytes = Buffer.from(await source.arrayBuffer());

  const [firstLine = 'AppWeaver AI'] = message.split('\n');
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': source.headers.get('content-type') ?? 'video/mp4',
        'X-Upload-Content-Length': String(bytes.length),
      },
      body: JSON.stringify({
        snippet: {
          title: firstLine.slice(0, 100),
          description: message.slice(0, 5000),
        },
        status: {
          privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS ?? 'public',
        },
      }),
    },
  );
  if (!init.ok) throw new Error(await readError(init));
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return an upload URL.');

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(bytes.length) },
    body: bytes,
  });
  if (!upload.ok) throw new Error(await readError(upload));
  return ((await upload.json()) as { id?: string }).id;
}

const POSTERS: Record<
  SocialPlatform,
  (content: PostContent) => Promise<string | undefined>
> = {
  FACEBOOK: postFacebook,
  X: postX,
  LINKEDIN: postLinkedIn,
  INSTAGRAM: postInstagram,
  TIKTOK: postTikTok,
  YOUTUBE: postYouTube,
};

export async function publishToPlatform(
  platform: SocialPlatform,
  content: PostContent,
): Promise<PlatformResult> {
  if (!isPlatformConfigured(platform)) {
    return { ok: false, error: 'Platform credentials are not configured.' };
  }
  try {
    return { ok: true, id: await POSTERS[platform](content) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fits the message to the platform. X is limited to 280 characters (video
 * links count as 23), so long messages are condensed by the model; any
 * failure falls back to hard truncation.
 */
export async function captionForPlatform(
  platform: SocialPlatform,
  message: string,
  hasVideo: boolean,
): Promise<string> {
  if (platform !== 'X') return message;

  const limit = hasVideo ? 255 : 280;
  if (message.length <= limit) return message;

  try {
    const response = await getAnthropicClient().messages.create({
      model: CAPTION_MODEL,
      max_tokens: 300,
      system: `Rewrite the marketing message as a single engaging post of at most ${limit} characters. Keep key hashtags and any URLs. Output only the post text.`,
      messages: [{ role: 'user', content: message }],
    });
    const block = response.content.find((c) => c.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (text && text.length <= limit) return text;
  } catch (error) {
    console.error('[social] caption rewrite failed:', error);
  }

  return `${message.slice(0, limit - 1).trimEnd()}…`;
}

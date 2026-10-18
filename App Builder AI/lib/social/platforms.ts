import { getAnthropicClient } from '@/lib/anthropic';

export type SocialPlatform = 'FACEBOOK' | 'X' | 'LINKEDIN';

export const ALL_PLATFORMS: SocialPlatform[] = ['FACEBOOK', 'X', 'LINKEDIN'];

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

const POSTERS: Record<
  SocialPlatform,
  (content: PostContent) => Promise<string | undefined>
> = { FACEBOOK: postFacebook, X: postX, LINKEDIN: postLinkedIn };

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

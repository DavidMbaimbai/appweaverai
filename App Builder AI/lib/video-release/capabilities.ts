import type { VideoAspect } from '@/lib/video/providers/types';

export const RELEASE_PLATFORMS = ['YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'TIKTOK'] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export const RELEASE_PLATFORM_LABELS: Record<ReleasePlatform, string> = {
  YOUTUBE: 'YouTube',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram Reels',
  LINKEDIN: 'LinkedIn',
  X: 'X',
  TIKTOK: 'TikTok',
};

export function isReleasePlatform(value: unknown): value is ReleasePlatform {
  return typeof value === 'string' && (RELEASE_PLATFORMS as readonly string[]).includes(value);
}

/** This app buffers the video in memory to upload it, so it never handles files above this size. */
export const APP_MAX_VIDEO_BYTES = 256 * 1024 * 1024;

export type PlatformLimits = {
  minSeconds: number;
  maxSeconds: number;
  maxBytes: number;
  aspects: VideoAspect[];
  maxTitle: number;
  /** Longest caption/description including hashtags. */
  maxCaption: number;
};

const ALL_ASPECTS: VideoAspect[] = ['16:9', '9:16', '1:1'];

/**
 * Conservative limits taken from each platform's public API documentation at
 * the time of writing. Platforms change them; a stricter value here only ever
 * blocks a release, it never causes a wrong publish claim.
 */
export const LIMITS: Record<ReleasePlatform, PlatformLimits> = {
  YOUTUBE: { minSeconds: 1, maxSeconds: 12 * 3600, maxBytes: APP_MAX_VIDEO_BYTES, aspects: ALL_ASPECTS, maxTitle: 100, maxCaption: 5000 },
  FACEBOOK: { minSeconds: 1, maxSeconds: 4 * 3600, maxBytes: APP_MAX_VIDEO_BYTES, aspects: ALL_ASPECTS, maxTitle: 255, maxCaption: 5000 },
  INSTAGRAM: { minSeconds: 3, maxSeconds: 90, maxBytes: APP_MAX_VIDEO_BYTES, aspects: ['9:16'], maxTitle: 100, maxCaption: 2200 },
  LINKEDIN: { minSeconds: 3, maxSeconds: 600, maxBytes: 200 * 1024 * 1024, aspects: ALL_ASPECTS, maxTitle: 100, maxCaption: 3000 },
  X: { minSeconds: 1, maxSeconds: 140, maxBytes: APP_MAX_VIDEO_BYTES, aspects: ALL_ASPECTS, maxTitle: 100, maxCaption: 280 },
  TIKTOK: { minSeconds: 3, maxSeconds: 600, maxBytes: APP_MAX_VIDEO_BYTES, aspects: ALL_ASPECTS, maxTitle: 100, maxCaption: 2200 },
};

export type DeliveryMode = 'automatic' | 'manual';

export type ReleaseEnv = Record<string, string | undefined>;

export type PlatformCapability = PlatformLimits & {
  platform: ReleasePlatform;
  label: string;
  /** Whether this deployment can publish automatically at all (credentials/config), before any user connects. */
  mode: DeliveryMode;
  /** Why it is manual, or the honest restrictions of automatic publishing. */
  note: string;
  /** Automatic posts are visible only to the owner until the platform audits the app. */
  privateOnly: boolean;
};

const has = (env: ReleaseEnv, ...names: string[]) => names.every((n) => Boolean(env[n]?.trim()));

/** What the platform and this deployment can do automatically; honest about every restriction. */
export function getCapability(platform: ReleasePlatform, env: ReleaseEnv = process.env): PlatformCapability {
  const base = { ...LIMITS[platform], platform, label: RELEASE_PLATFORM_LABELS[platform], privateOnly: false };
  switch (platform) {
    case 'YOUTUBE':
      return has(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
        ? { ...base, mode: 'automatic', note: 'Uploads through the YouTube Data API v3 (youtube.upload). Uploads from a Google API project that has not passed YouTube’s API audit are locked to private.' }
        : { ...base, mode: 'manual', note: 'Google OAuth is not configured on this deployment. Download the video and upload it in YouTube Studio.' };
    case 'FACEBOOK':
      return has(env, 'META_APP_ID', 'META_APP_SECRET')
        ? { ...base, mode: 'automatic', note: 'Publishes a Page video through the Graph API. Needs pages_manage_posts.' }
        : { ...base, mode: 'manual', note: 'Meta app is not configured on this deployment. Download the video and post it yourself.' };
    case 'INSTAGRAM':
      return has(env, 'META_APP_ID', 'META_APP_SECRET')
        ? { ...base, mode: 'automatic', note: 'Publishes a Reel through the Graph API. Needs an Instagram Business/Creator account linked to your Facebook Page and instagram_content_publish (Meta app review).' }
        : { ...base, mode: 'manual', note: 'Meta app is not configured on this deployment. Download the video and post it in Instagram.' };
    case 'LINKEDIN':
      return has(env, 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET')
        ? { ...base, mode: 'automatic', note: 'Publishes a member video post through the LinkedIn Videos and Posts APIs (w_member_social).' }
        : { ...base, mode: 'manual', note: 'LinkedIn app is not configured on this deployment. Download the video and post it yourself.' };
    case 'X':
      return env.VIDEO_RELEASE_X_AUTO === 'true' && has(env, 'X_CLIENT_ID')
        ? { ...base, mode: 'automatic', note: 'Uploads through the X media API. Needs the media.write scope and an X API plan that allows posting; reconnect X after enabling.' }
        : { ...base, mode: 'manual', note: 'X video upload needs the media.write scope and a paid X API plan, so it is not enabled here. Download the video and post it on X.' };
    case 'TIKTOK': {
      if (!has(env, 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET')) {
        return { ...base, mode: 'manual', note: 'TikTok is not configured on this deployment. Download the video and upload it in TikTok.' };
      }
      const audited = env.TIKTOK_APP_AUDITED === 'true';
      return {
        ...base,
        mode: 'automatic',
        privateOnly: !audited,
        note: audited
          ? 'Posts through the TikTok Content Posting API (Direct Post).'
          : 'TikTok only lets audited apps post publicly. Until this app passes the TikTok audit, automatic posts are uploaded as PRIVATE (only you can see them) and you must publish them from the TikTok app.',
      };
    }
  }
}

export type VideoFacts = {
  jobStatus: string;
  hasOutput: boolean;
  seconds: number;
  aspect: string;
  /** Null when the stored object size could not be read. */
  sizeBytes: number | null;
};

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Returns human-readable problems; empty means the video can go to this platform. */
export function validateVideoForPlatform(platform: ReleasePlatform, video: VideoFacts): string[] {
  const limits = LIMITS[platform];
  const label = RELEASE_PLATFORM_LABELS[platform];
  if (video.jobStatus !== 'SUCCEEDED' || !video.hasOutput) return ['The video has not finished generating.'];
  const problems: string[] = [];
  if (video.seconds < limits.minSeconds) problems.push(`${label} needs at least ${limits.minSeconds}s (video is ${video.seconds}s).`);
  if (video.seconds > limits.maxSeconds) problems.push(`${label} allows at most ${limits.maxSeconds}s (video is ${video.seconds}s).`);
  if (!(limits.aspects as string[]).includes(video.aspect)) {
    problems.push(`${label} needs ${limits.aspects.join(' or ')} video (this one is ${video.aspect}).`);
  }
  if (video.sizeBytes === null) problems.push('The video file size could not be verified.');
  else if (video.sizeBytes > limits.maxBytes) problems.push(`${label} allows at most ${mb(limits.maxBytes)} (video is ${mb(video.sizeBytes)}).`);
  return problems;
}

/** The text sent to the platform: YouTube keeps the title separate; the rest post caption (or title) plus hashtags. */
export function composeReleaseText(platform: ReleasePlatform, title: string, caption: string, hashtags: string[]): string {
  const tags = hashtags.map((t) => `#${t}`).join(' ');
  const body = platform === 'YOUTUBE' ? caption.trim() : caption.trim() || title.trim();
  return [body, tags].filter(Boolean).join('\n\n');
}

export function validateReleaseText(platform: ReleasePlatform, title: string, caption: string, hashtags: string[]): string[] {
  const limits = LIMITS[platform];
  const label = RELEASE_PLATFORM_LABELS[platform];
  const problems: string[] = [];
  if (!title.trim()) problems.push('A title is required.');
  if (title.trim().length > limits.maxTitle) problems.push(`${label} titles are limited to ${limits.maxTitle} characters.`);
  const text = composeReleaseText(platform, title, caption, hashtags);
  if (text.length > limits.maxCaption) problems.push(`${label} text is limited to ${limits.maxCaption} characters including hashtags (now ${text.length}).`);
  return problems;
}

/** Which stored SocialConnection carries a platform's token. Instagram uses the Facebook Page token. */
export function connectionPlatformFor(platform: ReleasePlatform) {
  return platform === 'INSTAGRAM' ? 'FACEBOOK' : platform;
}

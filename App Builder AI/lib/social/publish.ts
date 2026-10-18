import { sendAlert } from '@/lib/alerts';
import { prisma } from '@/lib/prisma';
import {
  ALL_PLATFORMS,
  captionForPlatform,
  isPlatformConfigured,
  publishToPlatform,
  VIDEO_ONLY_PLATFORMS,
  type PlatformResult,
  type SocialPlatform,
} from '@/lib/social/platforms';

const MAX_ATTEMPTS = 3;

export function normalizePlatforms(input: unknown): SocialPlatform[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => String(p).toUpperCase())
    .filter((p): p is SocialPlatform =>
      (ALL_PLATFORMS as string[]).includes(p),
    );
}

/**
 * Publishes the oldest due PENDING post to every target platform. Platforms
 * that already succeeded in an earlier attempt are not posted again, so a
 * partial failure is retried on the next run without duplicating posts.
 * Posts are marked FAILED after MAX_ATTEMPTS.
 */
export async function publishNextDueSocialPost() {
  const post = await prisma.socialPost.findFirst({
    where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
  });

  if (!post) return { posted: false as const, reason: 'No due posts.' };

  const targets = normalizePlatforms(post.platforms);
  const platforms = (targets.length ? targets : ALL_PLATFORMS).filter(
    (platform) =>
      isPlatformConfigured(platform) &&
      (post.videoUrl || !VIDEO_ONLY_PLATFORMS.includes(platform)),
  );

  const previous = (post.results ?? {}) as Record<string, PlatformResult>;
  const results: Record<string, PlatformResult> = { ...previous };

  for (const platform of platforms) {
    if (previous[platform]?.ok) continue;
    const caption = await captionForPlatform(
      platform,
      post.message,
      Boolean(post.videoUrl),
    );
    results[platform] = await publishToPlatform(platform, {
      message: caption,
      videoUrl: post.videoUrl,
    });
  }

  const allOk =
    platforms.length > 0 && platforms.every((p) => results[p]?.ok === true);
  const attempts = post.attempts + 1;
  const status = allOk
    ? 'POSTED'
    : attempts >= MAX_ATTEMPTS
      ? 'FAILED'
      : 'PENDING';

  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      status,
      attempts,
      results,
      postedAt: allOk ? new Date() : null,
    },
  });

  if (status === 'FAILED') {
    await sendAlert(
      `Social post failed: ${post.title}`,
      JSON.stringify(results).slice(0, 1200),
    );
  }

  return { posted: allOk, id: post.id, status, results };
}

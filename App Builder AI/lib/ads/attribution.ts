import { parseAttributionCookie } from '@/lib/ads/attribution-cookie';
import { prisma } from '@/lib/prisma';

/** First-touch attribution: stored once per user, never overwritten. */
export async function recordAttribution(userId: string, cookieHeader: string | null | undefined) {
  const attribution = parseAttributionCookie(cookieHeader);
  if (!attribution) return;
  await prisma.adAttribution.upsert({
    where: { userId },
    create: { userId, ...attribution },
    update: {},
  });
}

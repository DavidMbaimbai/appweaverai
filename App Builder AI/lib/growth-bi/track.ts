import { prisma } from '@/lib/prisma';

import { isFeatureEvent, type FeatureEventName } from './events';

/**
 * Records that a signed-in user used a product feature. Typed against the closed registry in ./events, deduped to one
 * row per user, feature, project and day, additive (never throws, never blocks the calling action). First-party,
 * stores only ids and a day: no IP, user-agent or content.
 */
export async function trackFeature(userId: string | null | undefined, name: FeatureEventName, opts: { projectId?: string | null } = {}) {
  if (!userId || !process.env.DATABASE_URL || !isFeatureEvent(name)) return;
  try {
    await prisma.growthFeatureEvent.createMany({
      data: [{ userId, name, projectKey: opts.projectId ?? '', day: new Date().toISOString().slice(0, 10) }],
      skipDuplicates: true,
    });
  } catch {
    // Telemetry must never break the action it observes.
  }
}

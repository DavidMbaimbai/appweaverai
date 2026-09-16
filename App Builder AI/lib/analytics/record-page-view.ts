import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';

/**
 * Records one anonymous visit to a published project's public URL. Fires
 * from app/p/[workspaceSlug]/[projectSlug]/page.tsx on every successful,
 * viewable render (never for private/forbidden results) — the single
 * chokepoint every published-app visit passes through, whether reached via
 * the default /p/... path or a rewritten custom domain (proxy.ts rewrites
 * custom domains to this same route before it renders).
 *
 * `visitorId` is a daily-rotating one-way hash of (day, projectId, IP,
 * user-agent) — never the raw IP or a persistent cookie — so it's only
 * suitable for a rough "unique visitors today" style count, not
 * cross-session/cross-day tracking of an individual.
 *
 * Best-effort: a failure here (e.g. a transient DB blip) must never break
 * the actual page render for a real visitor, so all errors are swallowed.
 */
export async function recordPageView({
  projectId,
  path,
  referrer,
  ip,
  userAgent,
}: {
  projectId: string;
  path: string;
  referrer: string | null;
  ip: string | null;
  userAgent: string | null;
}) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const visitorId = createHash('sha256')
      .update(`${day}:${projectId}:${ip ?? 'unknown'}:${userAgent ?? 'unknown'}`)
      .digest('hex')
      .slice(0, 40);

    await prisma.projectPageView.create({
      data: {
        projectId,
        path: path.slice(0, 500),
        referrer: referrer ? referrer.slice(0, 500) : null,
        visitorId,
      },
    });
  } catch {
    // Analytics must never break a visitor's page load.
  }
}

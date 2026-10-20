import { prisma } from '@/lib/prisma';

import {
  growthSecret,
  mayTrack,
  readGrowthCookie,
  type GrowthCookie,
  type Touch,
} from './attribution';

export async function recordVisit(cookie: GrowthCookie, touch: Touch) {
  await prisma.growthVisit.create({
    data: {
      visitorId: cookie.v,
      channel: touch.channel,
      source: touch.source,
      medium: touch.medium,
      campaign: touch.campaign,
      content: touch.content,
      term: touch.term,
      referrerHost: touch.referrerHost,
      landingPath: touch.landingPath,
    },
  });
}

/**
 * Stores first- and last-touch attribution for a new user from the signed cookie. Written once: a second call can
 * never overwrite the first-touch record. Skipped without analytics consent or with DNT/GPC.
 */
export async function recordGrowthSignup(userId: string, headers: { get(name: string): string | null } | null | undefined) {
  if (!headers || !mayTrack(headers)) return false;
  const cookie = readGrowthCookie(headers.get('cookie'), growthSecret());
  if (!cookie) return false;
  const f = cookie.first;
  const l = cookie.last;
  await prisma.growthAttribution.upsert({
    where: { userId },
    create: {
      userId,
      visitorId: cookie.v,
      firstChannel: f.channel,
      firstSource: f.source ?? null,
      firstMedium: f.medium ?? null,
      firstCampaign: f.campaign ?? null,
      firstContent: f.content ?? null,
      firstReferrerHost: f.referrerHost ?? null,
      firstLandingPath: f.landingPath,
      firstAt: new Date(f.at),
      lastChannel: l.channel,
      lastSource: l.source ?? null,
      lastMedium: l.medium ?? null,
      lastCampaign: l.campaign ?? null,
      lastContent: l.content ?? null,
      lastReferrerHost: l.referrerHost ?? null,
      lastLandingPath: l.landingPath,
      lastAt: new Date(l.at),
    },
    update: {},
  });
  return true;
}

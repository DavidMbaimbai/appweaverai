'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { isValidTimeZone } from '@/lib/ads/schedule';
import { requireUserId } from '@/lib/auth/require-user';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { isReleasePlatform, type ReleasePlatform } from '@/lib/video-release/capabilities';
import { normalizeLanguages } from '@/lib/video-release/localize';
import { recommendTimes, upcomingSlots, type Recommendation } from '@/lib/video-release/recommend';
import type { SeriesPattern } from '@/lib/video-release/series';
import {
  approveRelease,
  cancelRelease,
  pauseRelease,
  resumeRelease,
  retryRelease,
  scheduleReleases,
  updateRelease,
  type Target,
} from '@/lib/video-release/service';

const PAGE = '/app/studio/video/schedule';

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

async function currentUser() {
  const auth = await requireUserId();
  return auth.error || !auth.userId ? null : auth.userId;
}

const NOT_SIGNED_IN: Fail = { ok: false, error: 'You must be signed in.' };

export type PatternInput = {
  kind: 'daily' | 'weekly' | 'interval' | 'explicit';
  time: string;
  weekdays: number[];
  everyDays: number;
  /** Explicit local times, "YYYY-MM-DDTHH:mm". */
  localTimes: string[];
};

function toPattern(input: PatternInput): SeriesPattern {
  switch (input.kind) {
    case 'daily':
      return { type: 'daily', time: input.time };
    case 'weekly':
      return { type: 'weekly', weekdays: input.weekdays, time: input.time };
    case 'interval':
      return { type: 'interval', everyDays: Number(input.everyDays), time: input.time };
    default:
      return { type: 'explicit', localTimes: input.localTimes.map(String) };
  }
}

export type ScheduleActionInput = {
  /** A single finished job, or a whole video project released as episodes. */
  jobId?: string;
  videoProjectId?: string;
  platforms: string[];
  timeZone: string;
  pattern: PatternInput;
  startDate: string;
  title: string;
  caption: string;
  hashtags: string[];
  sourceLanguage: string;
  languages: string[];
  languageSchedules?: Record<string, { pattern: PatternInput; startDate: string }>;
  saveAsDraft?: boolean;
};

export async function scheduleVideoAction(input: ScheduleActionInput): Promise<Ok<{ created: number; localized: string[] }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  if (!isValidTimeZone(input.timeZone)) return { ok: false, error: 'Unknown time zone.' };
  const platforms = input.platforms.filter(isReleasePlatform);
  const languages = normalizeLanguages(input.languages);
  if (languages.length > 0) {
    const limit = await rateLimit(`video-release-ai:${userId}`, 10, 60 * 60_000);
    if (!limit.ok) return { ok: false, error: 'Too many localization requests. Try again later.' };
  }

  let targets: Target[] = [];
  let videoProjectId: string | null = null;
  let seriesKey: string | null = null;
  if (input.videoProjectId) {
    const project = await prisma.videoProject.findFirst({
      where: { id: input.videoProjectId, userId },
      include: { scenes: { orderBy: { order: 'asc' } } },
    });
    if (!project) return { ok: false, error: 'Video project not found.' };
    videoProjectId = project.id;
    const scenes = project.scenes.filter((s) => s.jobId);
    targets = scenes.map((s, i) => ({
      jobId: s.jobId as string,
      sceneId: s.id,
      season: project.kind === 'SERIES' ? (s.season ?? 1) : null,
      episode: project.kind === 'SERIES' ? (s.episode ?? i + 1) : null,
    }));
    if (project.kind === 'SERIES') seriesKey = randomUUID();
  } else if (input.jobId) {
    const scene = await prisma.videoScene.findFirst({ where: { jobId: input.jobId, videoProject: { userId } }, select: { id: true, videoProjectId: true } });
    targets = [{ jobId: input.jobId, sceneId: scene?.id ?? null, season: null, episode: null }];
    videoProjectId = scene?.videoProjectId ?? null;
  }

  const result = await scheduleReleases(userId, {
    videoProjectId,
    targets,
    seriesKey,
    platforms: platforms as ReleasePlatform[],
    timeZone: input.timeZone,
    pattern: toPattern(input.pattern),
    startDate: input.startDate,
    copy: { language: input.sourceLanguage || 'en', title: input.title, caption: input.caption, hashtags: input.hashtags },
    languages: languages.filter((l) => l !== (input.sourceLanguage || 'en')),
    languageSchedules: input.languageSchedules
      ? Object.fromEntries(
          Object.entries(input.languageSchedules).map(([lang, s]) => [lang, { pattern: toPattern(s.pattern), startDate: s.startDate }]),
        )
      : undefined,
    saveAsDraft: input.saveAsDraft,
  });
  if (result.ok) revalidatePath(PAGE);
  return result;
}

async function mutate(id: string, run: (userId: string) => Promise<Ok | Fail>): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const result = await run(userId);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function approveReleaseAction(id: string) {
  return mutate(id, (u) => approveRelease(u, id));
}
export async function pauseReleaseAction(id: string) {
  return mutate(id, (u) => pauseRelease(u, id));
}
export async function resumeReleaseAction(id: string) {
  return mutate(id, (u) => resumeRelease(u, id));
}
export async function cancelReleaseAction(id: string) {
  return mutate(id, (u) => cancelRelease(u, id));
}
export async function retryReleaseAction(id: string) {
  return mutate(id, (u) => retryRelease(u, id));
}

export async function updateReleaseAction(
  id: string,
  patch: { title?: string; caption?: string; hashtags?: string[]; localTime?: string; timeZone?: string },
): Promise<Ok | Fail> {
  if (patch.timeZone && !isValidTimeZone(patch.timeZone)) return { ok: false, error: 'Unknown time zone.' };
  return mutate(id, (u) => updateRelease(u, id, patch));
}

export type RecommendationView = Omit<Recommendation, 'windows'> & {
  windows: Recommendation['windows'];
  upcoming: string[];
};

export async function recommendTimesAction(platform: string, timeZone: string): Promise<Ok<{ recommendation: RecommendationView }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  if (!isReleasePlatform(platform) || !isValidTimeZone(timeZone)) return { ok: false, error: 'Unknown platform or time zone.' };
  const rows = await prisma.videoRelease.findMany({
    where: { userId, platform, status: 'PUBLISHED', publishedAt: { not: null } },
    orderBy: { publishedAt: 'desc' },
    take: 200,
    select: { platform: true, publishedAt: true, metrics: true },
  });
  const history = rows.flatMap((r) => {
    const views = (r.metrics as { views?: unknown } | null)?.views;
    return r.publishedAt ? [{ platform: r.platform, publishedAt: r.publishedAt, views: typeof views === 'number' ? views : null }] : [];
  });
  const recommendation = recommendTimes(platform, history, timeZone);
  return {
    ok: true,
    recommendation: { ...recommendation, upcoming: upcomingSlots(recommendation.windows, timeZone).map((d) => d.toISOString()) },
  };
}

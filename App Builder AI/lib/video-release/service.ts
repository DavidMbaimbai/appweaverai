import type { Prisma } from '@/lib/generated/prisma/client';
import { zonedTimeToUtc } from '@/lib/ads/schedule';
import { prisma } from '@/lib/prisma';
import { normalizeHashtags } from '@/lib/project-marketing/logic';
import { getVideoObjectSize, getVideoStorageConfig } from '@/lib/video/storage';

import {
  isReleasePlatform,
  validateReleaseText,
  validateVideoForPlatform,
  type ReleasePlatform,
  type VideoFacts,
} from './capabilities';
import { localizeCopy, normalizeLanguages, type VariantCopy } from './localize';
import { generateSeries, sequenceOrderError, type SeriesPattern } from './series';
import {
  EDITABLE,
  PENDING,
  STALE_AFTER_MS,
  pendingLimit,
  releaseIdempotencyKey,
  type ReleaseStatus,
} from './status';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MIN_LEAD_MS = 2 * 60_000;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Everything the validators need about a generated video. Size is read from storage, never assumed. */
export async function loadVideoFacts(job: {
  status: string;
  outputKey: string | null;
  seconds: number;
  aspect: string;
}): Promise<VideoFacts> {
  let sizeBytes: number | null = null;
  if (job.status === 'SUCCEEDED' && job.outputKey && getVideoStorageConfig().ok) {
    try {
      sizeBytes = await getVideoObjectSize(job.outputKey);
    } catch {
      sizeBytes = null;
    }
  }
  return { jobStatus: job.status, hasOutput: Boolean(job.outputKey), seconds: job.seconds, aspect: job.aspect, sizeBytes };
}

type ReleaseRow = Awaited<ReturnType<typeof prisma.videoRelease.findFirstOrThrow>>;

/** Problems that block approval or publishing: text limits plus the video itself. */
export async function releaseProblems(release: ReleaseRow): Promise<string[]> {
  const platform = release.platform as ReleasePlatform;
  const problems = validateReleaseText(platform, release.title, release.caption, release.hashtags);
  const job = await prisma.videoJob.findUnique({
    where: { id: release.jobId },
    select: { status: true, outputKey: true, seconds: true, aspect: true },
  });
  if (!job) return [...problems, 'The video no longer exists.'];
  return [...problems, ...validateVideoForPlatform(platform, await loadVideoFacts(job))];
}

export type ReleaseCopy = { language: string; title: string; caption: string; hashtags: string[] };

export type Target = { jobId: string; sceneId: string | null; season: number | null; episode: number | null };

export type ScheduleInput = {
  videoProjectId: string | null;
  targets: Target[];
  seriesKey: string | null;
  platforms: ReleasePlatform[];
  timeZone: string;
  pattern: SeriesPattern;
  /** Local "YYYY-MM-DD" of the first slot (ignored for explicit patterns). */
  startDate: string;
  copy: ReleaseCopy;
  /** Extra languages; the AI localizes the copy for each, never faked. */
  languages: string[];
  languageSchedules?: Record<string, { pattern: SeriesPattern; startDate: string }>;
  saveAsDraft?: boolean;
  now?: Date;
};

const episodeTag = (t: Target) => (t.episode !== null ? ` · S${t.season ?? 1}E${t.episode}` : '');

/** Creates every release of one scheduling operation (platforms x languages x episodes) or none. */
export async function scheduleReleases(userId: string, input: ScheduleInput): Promise<Result<{ created: number; localized: string[] }>> {
  const now = input.now ?? new Date();
  if (input.targets.length === 0) return fail('Choose at least one finished video.');
  const platforms = [...new Set(input.platforms)].filter(isReleasePlatform);
  if (platforms.length === 0) return fail('Choose at least one platform.');
  const copy = { ...input.copy, hashtags: normalizeHashtags(input.copy.hashtags), title: input.copy.title.trim(), caption: input.copy.caption.trim() };
  if (!copy.title) return fail('A title is required.');

  const jobs = await prisma.videoJob.findMany({
    where: { id: { in: input.targets.map((t) => t.jobId) }, userId },
    select: { id: true },
  });
  if (jobs.length !== new Set(input.targets.map((t) => t.jobId)).size) return fail('One of the videos was not found.');
  if (input.videoProjectId) {
    const project = await prisma.videoProject.findFirst({ where: { id: input.videoProjectId, userId }, select: { id: true } });
    if (!project) return fail('Video project not found.');
  }

  const languages = normalizeLanguages([copy.language, ...input.languages]);
  const others = languages.filter((l) => l !== copy.language);
  const variants = new Map<string, VariantCopy>([[copy.language, copy]]);
  if (others.length > 0) {
    let localized: VariantCopy[];
    try {
      localized = await localizeCopy(copy, others);
    } catch (error) {
      console.error('[video-release] localization failed:', error);
      return fail('Localization is unavailable right now. Try again or remove the extra languages.');
    }
    for (const v of localized) variants.set(v.language, v);
    const missing = others.filter((l) => !variants.has(l));
    if (missing.length) return fail(`Could not localize for: ${missing.join(', ')}. Nothing was scheduled.`);
  }

  const rows: Prisma.VideoReleaseCreateManyInput[] = [];
  for (const language of languages) {
    const schedule = input.languageSchedules?.[language] ?? { pattern: input.pattern, startDate: input.startDate };
    const series = generateSeries({
      pattern: schedule.pattern,
      timeZone: input.timeZone,
      startDate: schedule.startDate,
      count: input.targets.length,
      now: new Date(now.getTime() + MIN_LEAD_MS),
    });
    if (!series.ok) return fail(`${language}: ${series.error}`);
    if (series.slots.length !== input.targets.length) {
      return fail(`${language}: choose exactly ${input.targets.length} release time${input.targets.length === 1 ? '' : 's'}.`);
    }
    const variant = variants.get(language)!;
    for (const platform of platforms) {
      for (const [i, target] of input.targets.entries()) {
        const scheduledAt = series.slots[i].scheduledAt;
        const title = `${variant.title.slice(0, 100 - episodeTag(target).length)}${episodeTag(target)}`;
        const problems = validateReleaseText(platform, title, variant.caption, variant.hashtags);
        if (problems.length) return fail(`${language} / ${platform}: ${problems[0]}`);
        rows.push({
          userId,
          videoProjectId: input.videoProjectId,
          sceneId: target.sceneId,
          jobId: target.jobId,
          platform,
          language,
          title,
          caption: variant.caption,
          hashtags: variant.hashtags,
          scheduledAt,
          timeZone: input.timeZone,
          status: input.saveAsDraft ? 'DRAFT' : 'SCHEDULED',
          idempotencyKey: releaseIdempotencyKey({ userId, jobId: target.jobId, platform, language, scheduledAt }),
          season: target.season,
          episode: target.episode,
          seriesKey: input.seriesKey,
        });
      }
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { subscriptionPlan: true } });
  const limit = pendingLimit(user?.subscriptionPlan);
  const pending = await prisma.videoRelease.count({ where: { userId, status: { in: PENDING } } });
  if (!input.saveAsDraft && pending + rows.length > limit) {
    return fail(
      `Your plan allows ${limit} scheduled releases at a time (${pending} used, ${rows.length} requested).${limit < 200 ? ' Upgrade for more.' : ''}`,
    );
  }

  const existing = await prisma.videoRelease.count({
    where: { idempotencyKey: { in: rows.map((r) => r.idempotencyKey) } },
  });
  if (existing > 0) return fail('One of these releases is already scheduled for the same video, platform, language and time.');

  const created = await prisma.videoRelease.createMany({ data: rows, skipDuplicates: true });
  return { ok: true, created: created.count, localized: others };
}

async function owned(userId: string, id: string) {
  return prisma.videoRelease.findFirst({ where: { id, userId } });
}

export async function approveRelease(userId: string, id: string, now = new Date()): Promise<Result> {
  const release = await owned(userId, id);
  if (!release) return fail('Release not found.');
  if (!['SCHEDULED', 'FAILED', 'MANUAL'].includes(release.status)) return fail('This release cannot be approved in its current state.');
  const problems = await releaseProblems(release);
  if (problems.length) return fail(problems[0]);
  if (now.getTime() - release.scheduledAt.getTime() > STALE_AFTER_MS) return fail('This release is long overdue. Reschedule it first.');
  const done = await prisma.videoRelease.updateMany({
    where: { id, userId, status: { in: ['SCHEDULED', 'FAILED', 'MANUAL'] } },
    data: { status: 'APPROVED', approvedBy: userId, approvedAt: now, attempts: 0, nextAttemptAt: null, error: null },
  });
  return done.count ? { ok: true } : fail('The release changed. Refresh and try again.');
}

export async function pauseRelease(userId: string, id: string): Promise<Result> {
  const done = await prisma.videoRelease.updateMany({
    where: { id, userId, status: { in: ['SCHEDULED', 'APPROVED'] } },
    data: { status: 'PAUSED', approvedBy: null, approvedAt: null },
  });
  return done.count ? { ok: true } : fail('Only scheduled or approved releases can be paused.');
}

/** Resuming puts it back to "awaiting approval": a paused release is never published without a fresh approval. */
export async function resumeRelease(userId: string, id: string): Promise<Result> {
  const done = await prisma.videoRelease.updateMany({
    where: { id, userId, status: 'PAUSED' },
    data: { status: 'SCHEDULED' },
  });
  return done.count ? { ok: true } : fail('Only paused releases can be resumed.');
}

export async function cancelRelease(userId: string, id: string): Promise<Result> {
  const done = await prisma.videoRelease.updateMany({
    where: { id, userId, status: { in: ['DRAFT', 'SCHEDULED', 'APPROVED', 'PAUSED', 'FAILED', 'MANUAL'] } },
    data: { status: 'CANCELLED' },
  });
  return done.count ? { ok: true } : fail('This release can no longer be cancelled.');
}

/** Retry after FAILED / MANUAL: the owner's click is the approval; the attempt counter starts again. */
export async function retryRelease(userId: string, id: string, now = new Date()): Promise<Result> {
  const release = await owned(userId, id);
  if (!release) return fail('Release not found.');
  if (!['FAILED', 'MANUAL'].includes(release.status)) return fail('Only failed or manual releases can be retried.');
  const problems = await releaseProblems(release);
  if (problems.length) return fail(problems[0]);
  const scheduledAt = release.scheduledAt.getTime() < now.getTime() ? new Date(now.getTime() + MIN_LEAD_MS) : release.scheduledAt;
  const done = await prisma.videoRelease.updateMany({
    where: { id, userId, status: { in: ['FAILED', 'MANUAL'] } },
    data: { status: 'APPROVED', approvedBy: userId, approvedAt: now, attempts: 0, nextAttemptAt: null, error: null, scheduledAt },
  });
  return done.count ? { ok: true } : fail('The release changed. Refresh and try again.');
}

export type ReleasePatch = {
  title?: string;
  caption?: string;
  hashtags?: string[];
  /** Local "YYYY-MM-DDTHH:mm" in timeZone, or an exact instant. */
  scheduledAt?: Date;
  localTime?: string;
  timeZone?: string;
};

/** Edit or reschedule. An approved release goes back to awaiting approval, because what was approved changed. */
export async function updateRelease(userId: string, id: string, patch: ReleasePatch, now = new Date()): Promise<Result> {
  const release = await owned(userId, id);
  if (!release) return fail('Release not found.');
  if (!EDITABLE.includes(release.status as ReleaseStatus)) return fail('This release can no longer be edited.');

  const timeZone = patch.timeZone ?? release.timeZone;
  const scheduledAt = patch.localTime ? zonedTimeToUtc(patch.localTime, timeZone) : (patch.scheduledAt ?? release.scheduledAt);
  if (!scheduledAt) return fail('That date and time is not valid.');
  const timeChanged = scheduledAt.getTime() !== release.scheduledAt.getTime();
  if (timeChanged && scheduledAt.getTime() < now.getTime() + MIN_LEAD_MS) return fail('Pick a time in the future.');

  const title = (patch.title ?? release.title).trim();
  const caption = (patch.caption ?? release.caption).trim();
  const hashtags = patch.hashtags ? normalizeHashtags(patch.hashtags) : release.hashtags;
  const problems = validateReleaseText(release.platform as ReleasePlatform, title, caption, hashtags);
  if (problems.length) return fail(problems[0]);

  if (timeChanged && release.seriesKey) {
    const siblings = await prisma.videoRelease.findMany({ where: { userId, seriesKey: release.seriesKey } });
    const orderError = sequenceOrderError(release, scheduledAt, siblings);
    if (orderError) return fail(orderError);
  }

  const changed = timeChanged || title !== release.title || caption !== release.caption || hashtags.join() !== release.hashtags.join();
  const done = await prisma.videoRelease.updateMany({
    where: { id, userId, status: { in: EDITABLE } },
    data: {
      title,
      caption,
      hashtags,
      scheduledAt,
      timeZone,
      ...(changed && ['APPROVED', 'FAILED', 'MANUAL'].includes(release.status)
        ? { status: 'SCHEDULED', approvedBy: null, approvedAt: null, attempts: 0, nextAttemptAt: null, error: null }
        : {}),
    },
  });
  return done.count ? { ok: true } : fail('The release changed. Refresh and try again.');
}

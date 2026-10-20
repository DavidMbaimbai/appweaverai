import { sendAlert } from '@/lib/alerts';
import { prisma } from '@/lib/prisma';
import { getVideoObjectBytes, presignVideoUrl } from '@/lib/video/storage';

import { PUBLISHERS } from './adapters';
import { fetchYoutubeMetrics } from './adapters/youtube';
import {
  composeReleaseText,
  connectionPlatformFor,
  getCapability,
  type ReleasePlatform,
} from './capabilities';
import { notifyOwner } from './notify';
import { loadVideoFacts, releaseProblems } from './service';
import { afterFailure, claimForPublish, planDue, type Dueable } from './status';
import { usableToken } from './tokens';

const MAX_PER_RUN = 5;
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const PUBLISHING_STUCK_MS = 30 * 60 * 1000;
const METRICS_EVERY_MS = 6 * 60 * 60 * 1000;
const METRICS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Set VIDEO_RELEASE_DRY_RUN=true to log what would be published without claiming or calling any platform. */
export function isDryRun() {
  return process.env.VIDEO_RELEASE_DRY_RUN === 'true';
}

type Row = Awaited<ReturnType<typeof prisma.videoRelease.findMany>>[number];

export type RunSummary = {
  published: number;
  manual: number;
  failed: number;
  retrying: number;
  blocked: number;
  stale: number;
  reminders: number;
  metrics: number;
  dryRun: boolean;
};

async function finish(row: Row, data: Parameters<typeof prisma.videoRelease.update>[0]['data']) {
  // Retry the write once: losing the confirmation of a real post would invite a duplicate.
  try {
    await prisma.videoRelease.update({ where: { id: row.id }, data });
  } catch {
    await prisma.videoRelease.update({ where: { id: row.id }, data });
  }
}

async function publishOne(row: Row, summary: RunSummary) {
  const platform = row.platform as ReleasePlatform;
  const attempts = row.attempts + 1;
  const base = { userId: row.userId, platform: row.platform, title: row.title, scheduledAt: row.scheduledAt, timeZone: row.timeZone };

  const markNotified = async (sent: boolean) => {
    if (sent) await prisma.videoRelease.update({ where: { id: row.id }, data: { outcomeNotifiedAt: new Date() } });
  };

  const manual = async (reason: string, kind: 'expired-token' | 'manual') => {
    await finish(row, { status: 'MANUAL', error: reason });
    summary.manual++;
    await markNotified(await notifyOwner(kind, { ...base, error: reason }));
  };

  const giveUp = async (error: string) => {
    await finish(row, { status: 'FAILED', error, nextAttemptAt: null });
    summary.failed++;
    await markNotified(await notifyOwner('failed', { ...base, error }));
  };

  try {
    const problems = await releaseProblems(row);
    if (problems.length) return await giveUp(`Validation failed before publishing: ${problems[0]}`);

    const capability = getCapability(platform);
    if (capability.mode !== 'automatic') {
      return await manual(`${capability.label} cannot be published automatically. Download the video and post it yourself.`, 'manual');
    }
    const connection = await prisma.socialConnection.findUnique({
      where: { userId_platform: { userId: row.userId, platform: connectionPlatformFor(platform) } },
    });
    if (!connection) {
      return await manual(`${capability.label} is not connected. Connect it, or download the video and post it yourself.`, 'manual');
    }
    const token = await usableToken(connection);
    if (!token) {
      return await manual(`The ${capability.label} connection expired. Reconnect it, or download the video and post it yourself.`, 'expired-token');
    }

    const job = await prisma.videoJob.findUnique({ where: { id: row.jobId } });
    if (!job?.outputKey) return await giveUp('The video file is missing.');
    const outputKey = job.outputKey;
    const facts = await loadVideoFacts(job);

    const result = await PUBLISHERS[platform].publish({
      releaseId: row.id,
      idempotencyKey: row.idempotencyKey,
      title: row.title,
      text: composeReleaseText(platform, row.title, row.caption, row.hashtags),
      token,
      accountId: connection.accountId,
      seconds: job.seconds,
      aspect: job.aspect,
      sizeBytes: facts.sizeBytes ?? 0,
      getBytes: () => getVideoObjectBytes(outputKey),
      getPublicUrl: (ttl) => presignVideoUrl(outputKey, { expiresIn: ttl }),
      privateOnly: capability.privateOnly,
    });

    // PUBLISHED is written only when the platform itself returned an id.
    if (result.ok) {
      await finish(row, {
        status: 'PUBLISHED',
        externalId: result.externalId,
        postUrl: result.postUrl,
        publishedAt: new Date(),
        error: null,
        note: result.note ?? null,
        nextAttemptAt: null,
      });
      summary.published++;
      await markNotified(await notifyOwner('published', { ...base, postUrl: result.postUrl, note: result.note }));
      return;
    }

    if (result.authExpired) {
      return await manual(`${capability.label} rejected the connection. Reconnect it, or download the video and post it yourself.`, 'expired-token');
    }
    const next = afterFailure(attempts, result.retryable && !result.ambiguous);
    if (next.status === 'APPROVED') {
      await finish(row, { status: 'APPROVED', error: result.error, nextAttemptAt: next.nextAttemptAt });
      summary.retrying++;
      return;
    }
    return await giveUp(result.error);
  } catch (error) {
    console.error('[video-release] publish crashed:', error);
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown error';
    const next = afterFailure(attempts, true);
    if (next.status === 'APPROVED') {
      await finish(row, { status: 'APPROVED', error: message, nextAttemptAt: next.nextAttemptAt });
      summary.retrying++;
    } else {
      await giveUp(message);
    }
  }
}

async function recoverStuck(now: Date, summary: RunSummary) {
  const stuck = await prisma.videoRelease.findMany({
    where: { status: 'PUBLISHING', updatedAt: { lt: new Date(now.getTime() - PUBLISHING_STUCK_MS) } },
    take: 20,
  });
  const error =
    'The publish run was interrupted, so it is unknown whether it was posted. Check the account, then retry only if it is missing.';
  for (const row of stuck) {
    const done = await prisma.videoRelease.updateMany({ where: { id: row.id, status: 'PUBLISHING' }, data: { status: 'FAILED', error } });
    if (done.count) {
      summary.failed++;
      await notifyOwner('failed', { ...row, error });
    }
  }
}

async function sendReminders(now: Date, summary: RunSummary) {
  const rows = await prisma.videoRelease.findMany({
    where: {
      status: 'SCHEDULED',
      reminderSentAt: null,
      scheduledAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) },
    },
    take: 50,
  });
  for (const row of rows) {
    const marked = await prisma.videoRelease.updateMany({
      where: { id: row.id, status: 'SCHEDULED', reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (marked.count && (await notifyOwner('approval-reminder', row))) summary.reminders++;
  }
}

async function refreshMetrics(now: Date, summary: RunSummary) {
  const rows = await prisma.videoRelease.findMany({
    where: {
      status: 'PUBLISHED',
      platform: 'YOUTUBE',
      externalId: { not: null },
      publishedAt: { gt: new Date(now.getTime() - METRICS_WINDOW_MS) },
      OR: [{ metricsAt: null }, { metricsAt: { lt: new Date(now.getTime() - METRICS_EVERY_MS) } }],
    },
    take: 10,
  });
  for (const row of rows) {
    try {
      const connection = await prisma.socialConnection.findUnique({
        where: { userId_platform: { userId: row.userId, platform: 'YOUTUBE' } },
      });
      const token = connection ? await usableToken(connection) : null;
      const metrics = token && row.externalId ? await fetchYoutubeMetrics(token, row.externalId) : null;
      if (metrics) {
        await prisma.videoRelease.update({ where: { id: row.id }, data: { metrics, metricsAt: now } });
        summary.metrics++;
      }
    } catch (error) {
      console.error('[video-release] metrics failed:', error);
    }
  }
}

/** Publishes due, owner-approved releases; unapproved ones are only reminded about, never published. */
export async function runVideoReleases(now = new Date()): Promise<RunSummary> {
  const summary: RunSummary = {
    published: 0, manual: 0, failed: 0, retrying: 0, blocked: 0, stale: 0, reminders: 0, metrics: 0, dryRun: isDryRun(),
  };

  if (!isDryRun()) {
    await recoverStuck(now, summary);
    await sendReminders(now, summary);
  }

  const candidates = await prisma.videoRelease.findMany({
    where: { status: { in: ['APPROVED', 'SCHEDULED'] }, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
  });
  const seriesKeys = [...new Set(candidates.map((c) => c.seriesKey).filter((k): k is string => Boolean(k)))];
  const siblings = seriesKeys.length ? await prisma.videoRelease.findMany({ where: { seriesKey: { in: seriesKeys } } }) : [];
  const plan = planDue<Row & Dueable>(candidates as (Row & Dueable)[], siblings as (Row & Dueable)[], now);
  summary.blocked = plan.blocked.length;

  if (isDryRun()) {
    for (const row of plan.due.slice(0, MAX_PER_RUN)) {
      console.info(`[video-releases] DRY RUN ${row.platform} release ${row.id}: ${row.title.slice(0, 80)}`);
    }
    return summary;
  }

  for (const row of plan.stale) {
    const error =
      row.status === 'SCHEDULED'
        ? 'Not approved before its scheduled time (more than 48 hours ago), so it was never published. Reschedule and approve it.'
        : 'Missed its scheduled time by more than 48 hours. Reschedule and approve it again.';
    const done = await prisma.videoRelease.updateMany({
      where: { id: row.id, status: { in: ['APPROVED', 'SCHEDULED'] } },
      data: { status: 'FAILED', error },
    });
    if (done.count) {
      summary.stale++;
      await notifyOwner('failed', { ...row, error });
    }
  }

  for (const row of plan.due.slice(0, MAX_PER_RUN)) {
    if (!(await claimForPublish(prisma.videoRelease, row.id, row.attempts))) continue;
    await publishOne(row, summary);
  }

  await refreshMetrics(now, summary);
  if (summary.failed > 0) await sendAlert('Video releases failed', JSON.stringify(summary));
  return summary;
}

import { randomUUID } from 'node:crypto';

import type { VideoJob, VideoJobMode } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { videoChargeKey } from '@/lib/credits/keys';
import { refundCharge } from '@/lib/credits/ledger';
import { refundReservation } from '@/lib/marketing-credits/wallet';

import { getVideoProvider, listVideoProviders } from './providers/registry';
import {
  TransientVideoError,
  type VideoAspect,
  type VideoMode,
  type VideoProvider,
  type VideoRequest,
} from './providers/types';
import {
  VIDEO_MAX_ATTEMPTS,
  VIDEO_RUN_TIMEOUT_MS,
  checkVideoQuota,
  estimateProgress,
  monthlyVideoQuota,
  retryDelayMs,
} from './quota';
import {
  REJECTION_MESSAGES,
  selectVideoProvider,
  type SelectionCandidate,
  type SelectionPriority,
} from './select';
import { getVideoObjectBytes } from './storage';

const SUBMIT_LEASE_MS = 5 * 60_000;
const ACTIVE_STATUSES = ['QUEUED', 'SUBMITTED', 'RUNNING'] as const;
const CHARGEABLE_STATUSES = ['QUEUED', 'SUBMITTED', 'RUNNING', 'SUCCEEDED'] as const;

export type ProviderSettings = {
  enabled: boolean;
  models: string[];
  maxSecondsPerJob: number;
  dailyJobLimit: number;
  monthlyBudgetCents: number;
};

function defaultSettings(provider: VideoProvider): ProviderSettings {
  return {
    enabled: false,
    models: [provider.defaultModel],
    maxSecondsPerJob: 60,
    dailyJobLimit: 100,
    monthlyBudgetCents: 10_000,
  };
}

export async function getProviderSettings(provider: VideoProvider): Promise<ProviderSettings> {
  const row = await prisma.videoProviderConfig.findUnique({ where: { providerId: provider.id } });
  if (!row) return defaultSettings(provider);
  const models = Array.isArray(row.models)
    ? row.models.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    enabled: row.enabled,
    models: models.length > 0 ? models : [provider.defaultModel],
    maxSecondsPerJob: row.maxSecondsPerJob,
    dailyJobLimit: row.dailyJobLimit,
    monthlyBudgetCents: row.monthlyBudgetCents,
  };
}

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function dayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Month-to-date spend: finished/cancelled jobs at actual cost, in-flight at estimate. */
export async function providerUsage(providerId: string, now = new Date()) {
  const [settled, inflight, jobsToday] = await Promise.all([
    prisma.videoJob.aggregate({
      where: {
        providerId,
        createdAt: { gte: monthStart(now) },
        status: { in: ['SUCCEEDED', 'CANCELLED'] },
      },
      _sum: { actualCostCents: true },
    }),
    prisma.videoJob.aggregate({
      where: {
        providerId,
        createdAt: { gte: monthStart(now) },
        status: { in: ['QUEUED', 'SUBMITTED', 'RUNNING'] },
      },
      _sum: { estimatedCostCents: true },
    }),
    prisma.videoJob.count({
      where: { providerId, createdAt: { gte: dayStart(now) }, status: { not: 'CANCELLED' } },
    }),
  ]);
  return {
    jobsToday,
    spentThisMonthCents:
      (settled._sum.actualCostCents ?? 0) + (inflight._sum.estimatedCostCents ?? 0),
  };
}

export async function userVideosThisMonth(userId: string, now = new Date()) {
  return prisma.videoJob.count({
    where: {
      userId,
      createdAt: { gte: monthStart(now) },
      status: { in: [...CHARGEABLE_STATUSES] },
    },
  });
}

export type VideoPlan = {
  providerId: string;
  providerLabel: string;
  model: string;
  estimatedCostCents: number;
};

type PlanInput = {
  userId: string;
  mode: VideoMode;
  seconds: number;
  aspect: VideoAspect;
  priority?: SelectionPriority;
};

export type PlanResult =
  | { ok: true; plan: VideoPlan; remainingThisMonth: number }
  | { ok: false; error: string };

/** Picks a provider and checks every limit. Used for the confirm-before-generate quote and again at creation. */
export async function planVideo(input: PlanInput): Promise<PlanResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { subscriptionPlan: true },
  });
  if (!user) return { ok: false, error: 'User not found.' };

  const providers = listVideoProviders();
  const candidates: SelectionCandidate[] = [];
  const settingsById = new Map<string, ProviderSettings>();
  const usageById = new Map<string, Awaited<ReturnType<typeof providerUsage>>>();
  for (const provider of providers) {
    const settings = await getProviderSettings(provider);
    const usage = await providerUsage(provider.id);
    settingsById.set(provider.id, settings);
    usageById.set(provider.id, usage);
    candidates.push({
      provider,
      enabled: settings.enabled,
      available: provider.isConfigured().ok,
      maxSecondsPerJob: settings.maxSecondsPerJob,
      remainingDailyJobs: settings.dailyJobLimit - usage.jobsToday,
      remainingBudgetCents: settings.monthlyBudgetCents - usage.spentThisMonthCents,
    });
  }

  const selection = selectVideoProvider(
    { mode: input.mode, seconds: input.seconds, aspect: input.aspect, priority: input.priority },
    candidates,
  );
  if (!selection.ok) {
    const notConfigured = selection.rejections.find((item) => item.reason === 'not-configured');
    const message = notConfigured
      ? providers.find((p) => p.id === notConfigured.providerId)?.isConfigured()
      : null;
    return {
      ok: false,
      error:
        selection.reason === 'not-configured' && message && !message.ok
          ? message.reason
          : REJECTION_MESSAGES[selection.reason],
    };
  }

  const provider = getVideoProvider(selection.providerId)!;
  const settings = settingsById.get(provider.id)!;
  const usage = usageById.get(provider.id)!;
  const used = await userVideosThisMonth(input.userId);
  const quota = checkVideoQuota({
    plan: user.subscriptionPlan,
    userVideosThisMonth: used,
    seconds: input.seconds,
    estimatedCostCents: selection.estimatedCostCents,
    config: settings,
    providerJobsToday: usage.jobsToday,
    providerSpentThisMonthCents: usage.spentThisMonthCents,
  });
  if (!quota.ok) return { ok: false, error: quota.message };

  return {
    ok: true,
    plan: {
      providerId: provider.id,
      providerLabel: provider.label,
      model: settings.models[0] ?? provider.defaultModel,
      estimatedCostCents: selection.estimatedCostCents,
    },
    remainingThisMonth: Math.max(0, monthlyVideoQuota(user.subscriptionPlan) - used),
  };
}

export type CreateJobInput = PlanInput & {
  prompt: string;
  inputImageKey?: string | null;
  sceneId?: string;
  videoProjectId?: string;
  idempotencyKey?: string;
  /** If set, creation fails when the live estimate differs (price changed since the quote). */
  confirmedCostCents?: number;
};

export async function createVideoJob(
  input: CreateJobInput,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const existing = await prisma.videoJob.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return existing.userId === input.userId
      ? { ok: true, jobId: existing.id }
      : { ok: false, error: 'Invalid request.' };
  }

  const planned = await planVideo(input);
  if (!planned.ok) return planned;
  if (
    input.confirmedCostCents !== undefined &&
    input.confirmedCostCents !== planned.plan.estimatedCostCents
  ) {
    return { ok: false, error: 'The price changed. Review the new estimate and confirm again.' };
  }

  const provider = getVideoProvider(planned.plan.providerId)!;
  const invalid = provider.validate({
    mode: input.mode,
    prompt: input.prompt,
    seconds: input.seconds,
    aspect: input.aspect,
    idempotencyKey,
    inputImage: input.inputImageKey ? { format: 'png', bytes: Buffer.alloc(0) } : undefined,
  });
  if (invalid) return { ok: false, error: invalid };

  // Serialize quota checks so concurrent requests cannot overshoot limits.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('video-job-create'))`;
    const recheck = await planVideo(input);
    if (!recheck.ok) return recheck;
    const job = await tx.videoJob.create({
      data: {
        userId: input.userId,
        projectId: input.videoProjectId ?? null,
        providerId: planned.plan.providerId,
        model: planned.plan.model,
        mode: input.mode as VideoJobMode,
        prompt: input.prompt,
        inputImageKey: input.inputImageKey ?? null,
        seconds: input.seconds,
        aspect: input.aspect,
        estimatedCostCents: planned.plan.estimatedCostCents,
        idempotencyKey,
      },
    });
    if (input.sceneId) {
      await tx.videoScene.updateMany({
        where: { id: input.sceneId },
        data: { jobId: job.id },
      });
    }
    return { ok: true as const, jobId: job.id };
  });
  if (!created.ok) return created;

  // Submit right away; the cron retries it if this attempt fails transiently.
  await submitJob(created.jobId).catch((error) => {
    console.error('[video] inline submit failed:', error);
  });
  return created;
}

async function failJob(id: string, error: string) {
  const update = await prisma.videoJob.updateMany({
    where: { id, status: { in: [...ACTIVE_STATUSES] } },
    data: { status: 'FAILED', error: error.slice(0, 1000), actualCostCents: 0 },
  });
  if (update.count !== 1) return;
  const job = await prisma.videoJob.findUnique({ where: { id } });
  if (job) {
    await recordUsage(job, 'FAILURE');
    await refundCharge(videoChargeKey(job.idempotencyKey), 'Refund: video generation failed').catch((err) =>
      console.error('[video] credit refund failed:', err),
    );
    await refundReservation(videoChargeKey(job.idempotencyKey), 'Refund: video generation failed').catch((err) =>
      console.error('[video] marketing credit refund failed:', err),
    );
  }
}

async function recordUsage(job: VideoJob, status: 'SUCCESS' | 'FAILURE') {
  try {
    await prisma.aiUsageEvent.create({
      data: {
        userId: job.userId,
        provider: job.providerId,
        model: job.model,
        estimatedCostCents: status === 'SUCCESS' ? job.actualCostCents : 0,
        status,
        errorCategory: status === 'FAILURE' ? 'video_generation' : null,
      },
    });
  } catch (error) {
    console.error('[video] usage event failed:', error);
  }
}

async function loadInputImage(job: VideoJob): Promise<VideoRequest['inputImage']> {
  if (!job.inputImageKey) return undefined;
  const bytes = await getVideoObjectBytes(job.inputImageKey);
  return { format: 'png', bytes };
}

/** Claims and submits one QUEUED job. Safe to call from request handlers and cron. */
export async function submitJob(jobId: string): Promise<'submitted' | 'retry' | 'failed' | 'skipped'> {
  const now = new Date();
  const claim = await prisma.videoJob.updateMany({
    where: {
      id: jobId,
      status: 'QUEUED',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + SUBMIT_LEASE_MS) },
  });
  if (claim.count !== 1) return 'skipped';

  const job = await prisma.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  const provider = getVideoProvider(job.providerId);
  if (!provider) {
    await failJob(job.id, `Provider "${job.providerId}" is no longer available.`);
    return 'failed';
  }
  const configured = provider.isConfigured();
  if (!configured.ok) {
    await failJob(job.id, configured.reason);
    return 'failed';
  }

  try {
    const result = await provider.submit({
      mode: job.mode,
      prompt: job.prompt,
      seconds: job.seconds,
      aspect: job.aspect as VideoAspect,
      inputImage: await loadInputImage(job),
      idempotencyKey: job.idempotencyKey,
      model: job.model,
    });
    await prisma.videoJob.updateMany({
      where: { id: job.id, status: 'QUEUED' },
      data: {
        status: 'SUBMITTED',
        externalId: result.externalId,
        submittedAt: new Date(),
        nextAttemptAt: null,
        error: null,
      },
    });
    return 'submitted';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Submission failed.';
    const transient = error instanceof TransientVideoError;
    if (transient && job.attempts < VIDEO_MAX_ATTEMPTS) {
      await prisma.videoJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: {
          nextAttemptAt: new Date(Date.now() + retryDelayMs(job.attempts)),
          error: `Retrying after: ${message}`.slice(0, 1000),
        },
      });
      return 'retry';
    }
    await failJob(job.id, message);
    return 'failed';
  }
}

/** Polls one in-flight job and records the outcome. */
export async function pollJob(job: VideoJob): Promise<void> {
  const provider = getVideoProvider(job.providerId);
  if (!provider || !job.externalId) {
    await failJob(job.id, 'Job lost its provider reference.');
    return;
  }

  const startedAt = (job.submittedAt ?? job.createdAt).getTime();
  const elapsed = Date.now() - startedAt;

  let result;
  try {
    result = await provider.poll(job.externalId);
  } catch (error) {
    if (elapsed > VIDEO_RUN_TIMEOUT_MS) {
      await failJob(job.id, 'Timed out waiting for the provider.');
    } else {
      console.error('[video] poll failed:', error);
    }
    return;
  }

  if (result.status === 'FAILED') {
    await failJob(job.id, result.error ?? 'The provider failed to generate the video.');
    return;
  }

  if (result.status === 'SUCCEEDED') {
    try {
      const stored = await provider.fetchResult(job.externalId, result.outputRef);
      const cost = provider.estimateCostCents({
        mode: job.mode,
        seconds: job.seconds,
        model: job.model,
      });
      const update = await prisma.videoJob.updateMany({
        where: { id: job.id, status: { in: ['SUBMITTED', 'RUNNING'] } },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          outputKey: stored.outputKey,
          actualCostCents: cost,
          error: null,
        },
      });
      if (update.count === 1) {
        await recordUsage({ ...job, actualCostCents: cost }, 'SUCCESS');
      }
    } catch (error) {
      if (elapsed > VIDEO_RUN_TIMEOUT_MS) {
        await failJob(job.id, 'The finished video could not be retrieved.');
      } else {
        console.error('[video] fetchResult failed:', error);
      }
    }
    return;
  }

  if (elapsed > VIDEO_RUN_TIMEOUT_MS) {
    await failJob(job.id, 'Timed out waiting for the provider.');
    return;
  }
  await prisma.videoJob.updateMany({
    where: { id: job.id, status: { in: ['SUBMITTED', 'RUNNING'] } },
    data: {
      status: 'RUNNING',
      progress: Math.max(job.progress, result.progress ?? estimateProgress(elapsed, job.seconds)),
    },
  });
}

/** Cron entry point: submits due QUEUED jobs and polls in-flight ones. */
export async function processVideoJobs() {
  const now = new Date();
  const queued = await prisma.videoJob.findMany({
    where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true },
  });
  const counts = { submitted: 0, retry: 0, failed: 0, skipped: 0, polled: 0 };
  for (const { id } of queued) counts[await submitJob(id)] += 1;

  const active = await prisma.videoJob.findMany({
    where: { status: { in: ['SUBMITTED', 'RUNNING'] } },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
  for (const job of active) {
    await pollJob(job);
    counts.polled += 1;
  }
  return counts;
}

export async function cancelVideoJob(
  userId: string,
  jobId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const job = await prisma.videoJob.findFirst({ where: { id: jobId, userId } });
  if (!job) return { ok: false, error: 'Video not found.' };
  if (!ACTIVE_STATUSES.includes(job.status as (typeof ACTIVE_STATUSES)[number])) {
    return { ok: false, error: 'This video is already finished.' };
  }

  const provider = getVideoProvider(job.providerId);
  const submitted = job.status !== 'QUEUED';
  let providerCancelled = false;
  if (submitted && job.externalId && provider?.cancel) {
    try {
      await provider.cancel(job.externalId);
      providerCancelled = true;
    } catch (error) {
      console.error('[video] provider cancel failed:', error);
    }
  }

  // A submitted job that cannot be cancelled upstream may still be billed.
  const billed = submitted && !providerCancelled;
  const update = await prisma.videoJob.updateMany({
    where: { id: job.id, status: { in: [...ACTIVE_STATUSES] } },
    data: { status: 'CANCELLED', actualCostCents: billed ? job.estimatedCostCents : 0 },
  });
  if (update.count !== 1) return { ok: false, error: 'This video is already finished.' };
  if (!billed) {
    await refundCharge(videoChargeKey(job.idempotencyKey), 'Refund: video cancelled before generation').catch((err) =>
      console.error('[video] credit refund failed:', err),
    );
    await refundReservation(videoChargeKey(job.idempotencyKey), 'Refund: video cancelled before generation').catch(
      (err) => console.error('[video] marketing credit refund failed:', err),
    );
  }

  return {
    ok: true,
    message: billed
      ? 'Stopped tracking this video. The provider cannot cancel a running generation, so it may still be billed.'
      : 'Video cancelled.',
  };
}

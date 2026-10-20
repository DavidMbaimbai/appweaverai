'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';

import { videoChargeKey } from '@/lib/credits/keys';
import { getMarketingHint, withMarketingCredits } from '@/lib/marketing-credits/run';
import { requireUserId } from '@/lib/auth/require-user';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { cancelVideoJob, createVideoJob, planVideo } from '@/lib/video/jobs';

const MAX_PROJECTS = 50;
const MAX_SCENES = 100;
const MAX_PROMPT = 4000;
const PAGE = '/app/studio/video';

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

async function currentUser() {
  const auth = await requireUserId();
  return auth.error || !auth.userId ? null : auth.userId;
}

async function ownedScene(userId: string, sceneId: string) {
  return prisma.videoScene.findFirst({
    where: { id: sceneId, videoProject: { userId } },
    include: { videoProject: { select: { id: true, kind: true } } },
  });
}

const NOT_SIGNED_IN: Fail = { ok: false, error: 'You must be signed in.' };

export async function createVideoProjectAction(
  title: string,
  kind: 'STANDALONE' | 'SERIES',
): Promise<Ok<{ id: string }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const clean = title.trim().slice(0, 120);
  if (!clean) return { ok: false, error: 'Give the project a title.' };
  if ((await prisma.videoProject.count({ where: { userId } })) >= MAX_PROJECTS) {
    return { ok: false, error: `You can have up to ${MAX_PROJECTS} video projects.` };
  }
  const project = await prisma.videoProject.create({
    data: {
      userId,
      title: clean,
      kind,
      scenes: { create: { order: 0, prompt: '', seconds: 6, ...(kind === 'SERIES' ? { season: 1, episode: 1 } : {}) } },
    },
  });
  revalidatePath(PAGE);
  return { ok: true, id: project.id };
}

export async function deleteVideoProjectAction(id: string): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  await prisma.videoProject.deleteMany({ where: { id, userId } });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function addSceneAction(projectId: string): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const project = await prisma.videoProject.findFirst({
    where: { id: projectId, userId },
    include: { scenes: { orderBy: { order: 'desc' }, take: 1 }, _count: { select: { scenes: true } } },
  });
  if (!project) return { ok: false, error: 'Project not found.' };
  if (project._count.scenes >= MAX_SCENES) {
    return { ok: false, error: `A project can have up to ${MAX_SCENES} scenes.` };
  }
  const last = project.scenes[0];
  await prisma.videoScene.create({
    data: {
      videoProjectId: project.id,
      order: (last?.order ?? -1) + 1,
      prompt: '',
      seconds: 6,
      ...(project.kind === 'SERIES'
        ? { season: last?.season ?? 1, episode: (last?.episode ?? 0) + 1 }
        : {}),
    },
  });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function updateSceneAction(
  sceneId: string,
  data: { prompt: string; seconds: number; season?: number | null; episode?: number | null },
): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const scene = await ownedScene(userId, sceneId);
  if (!scene) return { ok: false, error: 'Scene not found.' };
  if (!Number.isInteger(data.seconds) || data.seconds < 6 || data.seconds > 120 || data.seconds % 6 !== 0) {
    return { ok: false, error: 'Duration must be a multiple of 6 seconds (6 to 120).' };
  }
  const numberOrNull = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
  const series = scene.videoProject.kind === 'SERIES';
  await prisma.videoScene.update({
    where: { id: scene.id },
    data: {
      prompt: data.prompt.slice(0, MAX_PROMPT),
      seconds: data.seconds,
      season: series ? numberOrNull(data.season) : null,
      episode: series ? numberOrNull(data.episode) : null,
    },
  });
  return { ok: true };
}

export async function moveSceneAction(sceneId: string, direction: 'up' | 'down'): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const scene = await ownedScene(userId, sceneId);
  if (!scene) return { ok: false, error: 'Scene not found.' };
  const neighbor = await prisma.videoScene.findFirst({
    where: {
      videoProjectId: scene.videoProjectId,
      order: direction === 'up' ? { lt: scene.order } : { gt: scene.order },
    },
    orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
  });
  if (!neighbor) return { ok: true };
  await prisma.$transaction([
    prisma.videoScene.update({ where: { id: scene.id }, data: { order: neighbor.order } }),
    prisma.videoScene.update({ where: { id: neighbor.id }, data: { order: scene.order } }),
  ]);
  revalidatePath(PAGE);
  return { ok: true };
}

export async function deleteSceneAction(sceneId: string): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const scene = await ownedScene(userId, sceneId);
  if (!scene) return { ok: false, error: 'Scene not found.' };
  await prisma.videoScene.delete({ where: { id: scene.id } });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeSceneImageAction(sceneId: string): Promise<Ok | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const scene = await ownedScene(userId, sceneId);
  if (!scene) return { ok: false, error: 'Scene not found.' };
  await prisma.videoScene.update({ where: { id: scene.id }, data: { referenceImageKey: null } });
  revalidatePath(PAGE);
  return { ok: true };
}

export type SceneQuote = {
  estimatedCostCents: number;
  seconds: number;
  providerLabel: string;
  mode: 'TEXT' | 'IMAGE';
  remainingThisMonth: number;
  /** Marketing credits charged for this scene (0 for internal/platform runs). */
  credits: number;
  maxCredits: number;
  creditBalance: number;
};

function sceneRequest(scene: { prompt: string; seconds: number; referenceImageKey: string | null }) {
  return {
    mode: scene.referenceImageKey ? ('IMAGE' as const) : ('TEXT' as const),
    seconds: scene.seconds,
    aspect: '16:9' as const,
  };
}

/** Price and limit check shown to the user before they confirm generation. */
export async function quoteSceneAction(sceneId: string): Promise<Ok<{ quote: SceneQuote }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const scene = await ownedScene(userId, sceneId);
  if (!scene) return { ok: false, error: 'Scene not found.' };
  if (!scene.prompt.trim()) return { ok: false, error: 'Write a prompt for this scene first.' };
  const request = sceneRequest(scene);
  const planned = await planVideo({ userId, ...request });
  if (!planned.ok) return planned;
  const hint = await getMarketingHint(userId, 'video_per_second', { seconds: request.seconds });
  return {
    ok: true,
    quote: {
      estimatedCostCents: planned.plan.estimatedCostCents,
      seconds: request.seconds,
      providerLabel: planned.plan.providerLabel,
      mode: request.mode,
      remainingThisMonth: planned.remainingThisMonth,
      credits: hint.quote.credits,
      maxCredits: hint.quote.maxCredits,
      creditBalance: hint.available,
    },
  };
}

export async function generateSceneAction(
  sceneId: string,
  confirmedCostCents: number,
): Promise<Ok<{ jobId: string }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;

  const limit = await rateLimit(`video-generate:${userId}`, 10, 60 * 60_000);
  if (!limit.ok) {
    return { ok: false, error: 'Too many generations. Please wait a bit before trying again.' };
  }

  const scene = await ownedScene(userId, sceneId);
  if (!scene) return { ok: false, error: 'Scene not found.' };
  if (!scene.prompt.trim()) return { ok: false, error: 'Write a prompt for this scene first.' };
  if (scene.jobId) {
    const current = await prisma.videoJob.findUnique({
      where: { id: scene.jobId },
      select: { status: true },
    });
    if (current && ['QUEUED', 'SUBMITTED', 'RUNNING'].includes(current.status)) {
      return { ok: false, error: 'This scene is already generating.' };
    }
  }

  const idempotencyKey = randomUUID();
  const request = sceneRequest(scene);
  const charged = await withMarketingCredits(
    {
      userId,
      operation: 'video_per_second',
      params: { seconds: request.seconds },
      refType: 'VideoScene',
      refId: scene.id,
      idempotencyKey: videoChargeKey(idempotencyKey),
      isFailure: (r: Awaited<ReturnType<typeof createVideoJob>>) => !r.ok,
    },
    () =>
      createVideoJob({
        userId,
        ...request,
        prompt: scene.prompt,
        inputImageKey: scene.referenceImageKey,
        sceneId: scene.id,
        videoProjectId: scene.videoProjectId,
        confirmedCostCents,
        idempotencyKey,
      }),
  );
  if (!charged.ok) return { ok: false, error: charged.error };
  const result = charged.value;
  if (!result.ok) return result;
  revalidatePath(PAGE);
  return { ok: true, jobId: result.jobId };
}

export async function cancelVideoJobAction(jobId: string): Promise<Ok<{ message: string }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const result = await cancelVideoJob(userId, jobId);
  if (!result.ok) return result;
  revalidatePath(PAGE);
  return result;
}

export type SceneJobStatus = {
  sceneId: string;
  jobId: string | null;
  status: 'QUEUED' | 'SUBMITTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | null;
  progress: number;
  error: string | null;
  costCents: number;
};

/** Polled by the studio UI. Never returns storage keys. */
export async function getSceneJobStatusesAction(
  projectId: string,
): Promise<Ok<{ statuses: SceneJobStatus[] }> | Fail> {
  const userId = await currentUser();
  if (!userId) return NOT_SIGNED_IN;
  const scenes = await prisma.videoScene.findMany({
    where: { videoProjectId: projectId, videoProject: { userId } },
    select: {
      id: true,
      job: {
        select: {
          id: true,
          status: true,
          progress: true,
          error: true,
          estimatedCostCents: true,
          actualCostCents: true,
        },
      },
    },
  });
  return {
    ok: true,
    statuses: scenes.map((scene) => ({
      sceneId: scene.id,
      jobId: scene.job?.id ?? null,
      status: scene.job?.status ?? null,
      progress: scene.job?.progress ?? 0,
      error: scene.job?.error ?? null,
      costCents: scene.job ? scene.job.actualCostCents || scene.job.estimatedCostCents : 0,
    })),
  };
}

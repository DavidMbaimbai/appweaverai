import type { Prisma } from '@/lib/generated/prisma/client';
import {
  completeActivity,
  getAgentSetting,
  isGloballyPaused,
  runAgentAction,
  type AgentRole,
  type AgentScope,
} from '@/lib/agents';
import { generateAdImage } from '@/lib/ads/image';
import { videoChargeKey } from '@/lib/credits/keys';
import { withMarketingCredits } from '@/lib/marketing-credits/run';
import { DEFAULT_MARKETING_PRICES } from '@/lib/marketing-credits/pricing';
import { prisma } from '@/lib/prisma';
import { approvedStatus, composePostText, isAutoPublishPlatform, type Platform } from '@/lib/project-marketing/logic';
import { connectionPlatform } from '@/lib/project-marketing/instagram';
import { syncCampaignStatus } from '@/lib/project-marketing/publish';
import { createVideoJob, planVideo } from '@/lib/video/jobs';
import { getVideoStorageConfig, putVideoObject } from '@/lib/video/storage';
import { isReleasePlatform, validateReleaseText } from '@/lib/video-release/capabilities';
import { approveRelease } from '@/lib/video-release/service';
import { releaseIdempotencyKey } from '@/lib/video-release/status';

import { generateIdeas, type GeneratedIdea, type GeneratedItem, type ProductFacts } from './generate';
import {
  dueRunDate,
  estimateDailyCredits,
  gateApproval,
  isTerminal,
  localParts,
  planSlots,
  runStatusFromSteps,
  validateGeneratedPost,
  videoStepFromJob,
} from './logic';
import {
  PIPELINE_STEPS,
  RUN_LOCK_MS,
  VIDEO_PLATFORMS,
  VIDEO_SECONDS,
  type PipelineStep,
  type StepMap,
  type StepState,
} from './types';

type Pipeline = NonNullable<Awaited<ReturnType<typeof prisma.contentPipeline.findUnique>>>;
type Run = NonNullable<Awaited<ReturnType<typeof prisma.contentRun.findUnique>>>;

const PLATFORM_SITE = 'https://appweaverai.com';
const PLATFORM_DESCRIPTION =
  'AppWeaver AI turns plain-language ideas into real, running web apps with an AI agent, live preview, publishing and custom domains.';
const HOUSE_MAX_LENGTH = 280;

type Item = GeneratedItem & { ideaIndex: number };

type Ctx = {
  pipeline: Pipeline;
  run: Run;
  steps: StepMap;
  errors: string[];
  scope: AgentScope;
  now: Date;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);
const iso = (d = new Date()) => d.toISOString();

export function scopeOfPipeline(p: Pick<Pipeline, 'scope' | 'projectId'>): AgentScope {
  return p.scope === 'PLATFORM' || !p.projectId ? { type: 'PLATFORM' } : { type: 'PROJECT', projectId: p.projectId };
}

/** Idempotency key for an agent activity of one step; the run start time changes when a failed run is retried. */
const activityKey = (ctx: Ctx, step: string) => `cp:${ctx.run.id}:${ctx.run.startedAt.getTime()}:${step}`;
const chargeKey = (ctx: Ctx, step: string) => `cp-${ctx.run.id}-${ctx.run.startedAt.getTime()}-${step}`;

function data<T>(ctx: Ctx, step: PipelineStep): T | undefined {
  return ctx.steps[step]?.data as T | undefined;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export async function getOrCreateRun(pipelineId: string, runDate: string, trigger: string) {
  try {
    const run = await prisma.contentRun.create({ data: { pipelineId, runDate, trigger, steps: {} } });
    return { run, created: true };
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const run = await prisma.contentRun.findUnique({ where: { pipelineId_runDate: { pipelineId, runDate } } });
    if (!run) throw error;
    return { run, created: false };
  }
}

export type AdvanceResult = { runId?: string; status: string; skipped?: string };

/** Advances (or starts) the one run of a pipeline for a local date. Safe to call repeatedly and concurrently. */
export async function advanceRun(
  pipelineId: string,
  runDate: string,
  opts: { trigger?: string; now?: Date; force?: boolean } = {},
): Promise<AdvanceResult> {
  const now = opts.now ?? new Date();
  const pipeline = await prisma.contentPipeline.findUnique({ where: { id: pipelineId } });
  if (!pipeline) return { status: 'skipped', skipped: 'Pipeline not found.' };

  const created = (await getOrCreateRun(pipelineId, runDate, opts.trigger ?? 'cron'));
  let run = created.run;
  if (created.created) await prisma.contentPipeline.update({ where: { id: pipelineId }, data: { lastRunAt: now } });

  if (isTerminal(run.status)) {
    const steps = run.steps as StepMap;
    const retryable = opts.force && run.status === 'FAILED' && steps.schedule?.status !== 'DONE';
    if (!retryable) return { runId: run.id, status: run.status, skipped: 'Already ran for this date.' };
    run = await prisma.contentRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', steps: {}, errors: [], finishedAt: null, startedAt: now, lockedUntil: null, trigger: opts.trigger ?? 'manual' },
    });
  }

  const claim = await prisma.contentRun.updateMany({
    where: { id: run.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + RUN_LOCK_MS) },
  });
  if (claim.count === 0) return { runId: run.id, status: run.status, skipped: 'Another worker is running it.' };

  const ctx: Ctx = {
    pipeline,
    run,
    steps: { ...(run.steps as StepMap) },
    errors: Array.isArray(run.errors) ? (run.errors as string[]) : [],
    scope: scopeOfPipeline(pipeline),
    now,
  };
  const save = (extra: Prisma.ContentRunUpdateInput = {}) =>
    prisma.contentRun.update({ where: { id: run.id }, data: { steps: json(ctx.steps), errors: json(ctx.errors), ...extra } });

  try {
    await executeSteps(ctx, save);
  } catch (error) {
    ctx.errors.push(`Run crashed: ${message(error)}`);
  }
  const finished = !ctx.steps.video || ctx.steps.video.status !== 'WAITING';
  const status = runStatusFromSteps(ctx.steps, finished && Boolean(ctx.steps.report));
  const done = isTerminal(status);
  const updated = await save({ status, lockedUntil: null, finishedAt: done ? new Date() : null });
  return { runId: updated.id, status };
}

const FINAL = new Set(['DONE', 'SKIPPED', 'FAILED', 'BLOCKED']);

async function executeSteps(ctx: Ctx, save: () => Promise<unknown>) {
  const handlers: Record<PipelineStep, (c: Ctx) => Promise<StepState>> = {
    strategy: stepStrategy,
    generate: stepGenerate,
    image: stepImage,
    video: stepVideo,
    validate: stepValidate,
    schedule: stepSchedule,
    report: stepReport,
  };
  for (const step of PIPELINE_STEPS) {
    const s = ctx.steps[step];
    const expired = ctx.now.getTime() - ctx.run.startedAt.getTime() > 72 * 3_600_000;
    if (expired && s && (s.status === 'WAITING' || s.status === 'AWAITING_APPROVAL')) {
      ctx.steps[step] = { ...s, status: s.status === 'WAITING' ? 'FAILED' : 'BLOCKED', detail: 'Expired after 72 hours without completing.' };
    }
  }
  for (const step of PIPELINE_STEPS) {
    const current = ctx.steps[step];
    if (current && FINAL.has(current.status)) continue;
    // Nothing downstream makes sense without a strategy and generated posts.
    const upstream = step !== 'strategy' && ctx.steps.strategy?.status !== 'DONE';
    const noPosts = !['strategy', 'generate'].includes(step) && ctx.steps.generate?.status !== 'DONE';
    if (upstream || noPosts) {
      ctx.steps[step] = { status: 'SKIPPED', at: iso(), detail: 'Skipped: an earlier step did not finish.' };
      await save();
      continue;
    }
    if (step === 'report' && ctx.steps.video?.status === 'WAITING') continue;
    try {
      ctx.steps[step] = { ...(await handlers[step](ctx)), at: iso() };
    } catch (error) {
      ctx.steps[step] = { status: 'FAILED', at: iso(), detail: message(error) };
    }
    const state = ctx.steps[step]!;
    if (state.status === 'FAILED' || state.status === 'BLOCKED') ctx.errors.push(`${step}: ${state.detail ?? state.status}`);
    await save();
  }
}

// ---------------------------------------------------------------------------
// Agent-gated helpers
// ---------------------------------------------------------------------------

type Draft<T> = { ok: true; value: T; activityId: string } | { ok: false; state: StepState };

/**
 * Drafting never publishes, so it runs in every mode, but the agent's kill switch, pause,
 * disabled state and daily limits are still enforced and the work is logged as an AgentActivity.
 */
async function draftStep<T>(
  ctx: Ctx,
  step: string,
  agent: AgentRole,
  action: string,
  input: string,
  work: () => Promise<{ summary: string; value: T }>,
  estimatedCostCents = 0,
): Promise<Draft<T>> {
  let value: T | undefined;
  const result = await runAgentAction({
    scope: ctx.scope,
    agent,
    action,
    category: 'content_draft',
    input,
    estimatedCostCents,
    idempotencyKey: activityKey(ctx, step),
    payload: { runId: ctx.run.id, step },
    execute: async () => {
      const r = await work();
      value = r.value;
      return { summary: r.summary };
    },
  });
  if (result.status === 'BLOCKED') return { ok: false, state: { status: 'BLOCKED', detail: result.reason, activityId: result.activityId } };
  if (result.status === 'FAILED') return { ok: false, state: { status: 'FAILED', detail: result.error ?? 'Failed.', activityId: result.activityId } };
  if (value === undefined) {
    const r = await work();
    value = r.value;
    if (result.status !== 'DONE') await completeActivity(result.activityId, { summary: r.summary });
  }
  return { ok: true, value, activityId: result.activityId };
}

type Approval = 'approved' | 'rejected' | 'pending';

/** Reads a human decision made in the approvals UI (approved activities become PLANNED with decidedBy set). */
async function approvalOf(activityId: string | undefined): Promise<Approval> {
  if (!activityId) return 'pending';
  const row = await prisma.agentActivity.findUnique({ where: { id: activityId }, select: { status: true, decidedBy: true } });
  if (!row) return 'pending';
  if (row.status === 'BLOCKED' && row.decidedBy) return 'rejected';
  if (row.decidedBy && (row.status === 'PLANNED' || row.status === 'DONE')) return 'approved';
  return 'pending';
}

async function gate(ctx: Ctx, category: string) {
  const [setting, globalPause] = await Promise.all([getAgentSetting(ctx.scope, 'CONTENT'), isGloballyPaused()]);
  return gateApproval({
    mode: setting.mode,
    enabled: setting.enabled,
    paused: setting.paused,
    agentCategories: setting.categories,
    pipelineCategories: ctx.pipeline.autoPublishCategories,
    category,
    scope: ctx.scope.type,
    globalPause,
  });
}

/** Charges the owner's marketing credits (internal cost for the platform owner) and throws when refused. */
async function paid<T>(
  ctx: Ctx,
  key: string,
  operation: 'campaign_draft' | 'translation' | 'image' | 'video_per_second',
  params: { seconds?: number; units?: number } | undefined,
  fn: () => Promise<T>,
  isFailure?: (v: T) => boolean,
): Promise<T> {
  const outcome = await withMarketingCredits(
    {
      userId: ctx.pipeline.ownerUserId,
      projectId: ctx.pipeline.projectId,
      operation,
      params,
      idempotencyKey: chargeKey(ctx, key),
      scheduled: true,
      retryable: true,
      refType: 'ContentRun',
      refId: ctx.run.id,
      isFailure,
    },
    fn,
  );
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.value;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type StrategyData = { facts: ProductFacts; recent: string[]; siteUrl: string | null; types: string[]; note?: string };

async function loadStrategy(p: Pipeline): Promise<{ facts: ProductFacts; recent: string[]; siteUrl: string | null }> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  if (p.scope === 'PLATFORM' || !p.projectId) {
    const owner = await prisma.user.findUnique({ where: { id: p.ownerUserId }, select: { adminRole: true } });
    if (!owner?.adminRole) throw new Error('The platform pipeline owner must be an admin so costs are recorded as internal.');
    const posts = await prisma.socialPost.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { message: true },
    });
    return {
      facts: {
        name: 'AppWeaver AI',
        description: PLATFORM_DESCRIPTION,
        url: PLATFORM_SITE,
        brand: null,
        knowledge: [],
        approvedFacts: process.env.SOCIAL_AD_FACTS?.trim() || null,
      },
      recent: posts.map((x) => x.message),
      siteUrl: PLATFORM_SITE,
    };
  }
  const project = await prisma.project.findFirst({
    where: { id: p.projectId, deletedAt: null },
    select: {
      name: true,
      description: true,
      brandKit: { select: { primaryColor: true, fontFamily: true } },
      knowledgeDocs: { orderBy: { createdAt: 'desc' }, take: 8, select: { title: true, content: true } },
    },
  });
  if (!project) throw new Error('Project not found.');
  const deployment = await prisma.deployment.findFirst({
    where: { projectId: p.projectId, isCurrent: true, status: 'LIVE' },
    select: { domain: true, customDomain: true },
  });
  const host = deployment?.customDomain || deployment?.domain;
  const url = host ? `https://${host}` : null;
  const posts = await prisma.projectPost.findMany({
    where: { campaign: { projectId: p.projectId }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { text: true },
  });
  return {
    facts: {
      name: project.name,
      description: project.description,
      url,
      brand: [project.brandKit?.primaryColor, project.brandKit?.fontFamily].filter(Boolean).join(', ') || null,
      knowledge: project.knowledgeDocs.map((d) => `${d.title}: ${d.content.slice(0, 600)}`),
    },
    recent: posts.map((x) => x.text),
    siteUrl: url,
  };
}

const price = (op: string) => DEFAULT_MARKETING_PRICES.find((x) => x.operation === op)?.creditCost ?? 0;

async function stepStrategy(ctx: Ctx): Promise<StepState> {
  const p = ctx.pipeline;
  const draft = await draftStep(ctx, 'strategy', 'MARKETING_DIRECTOR', 'content.strategy', `Load product facts and the last 30 days of posts (${ctx.scope.type}).`, async () => {
    const loaded = await loadStrategy(p);
    let types = p.contentTypes.filter((t) => t === 'post' || t === 'image' || t === 'video');
    let note: string | undefined;
    const prices = {
      campaign_draft: price('campaign_draft'),
      translation: price('translation'),
      image: price('image'),
      video_per_second: price('video_per_second'),
    };
    // Drop the most expensive content types until the estimated cost fits the daily credit cap.
    while (p.maxDailyCredits > 0 && estimateDailyCredits({ ...p, contentTypes: types }, prices) > p.maxDailyCredits && types.some((t) => t !== 'post')) {
      const drop = types.includes('video') ? 'video' : 'image';
      types = types.filter((t) => t !== drop);
      note = `${note ? `${note} ` : ''}Skipped ${drop}: estimated cost is above the daily cap of ${p.maxDailyCredits} credits.`;
    }
    const value: StrategyData = { ...loaded, types, note };
    return { summary: `Loaded facts and ${loaded.recent.length} recent posts.${note ? ` ${note}` : ''}`, value };
  });
  if (!draft.ok) return draft.state;
  return {
    status: 'DONE',
    activityId: draft.activityId,
    detail: `${draft.value.recent.length} posts from the last 30 days will be avoided.${draft.value.note ? ` ${draft.value.note}` : ''}`,
    data: draft.value as unknown as Record<string, unknown>,
  };
}

async function stepGenerate(ctx: Ctx): Promise<StepState> {
  const p = ctx.pipeline;
  const strategy = data<StrategyData>(ctx, 'strategy')!;
  const draft = await draftStep(ctx, 'generate', 'CONTENT', 'content.generate', `Write ${p.postsPerDay} idea(s) for ${p.platforms.join(', ')} in ${p.languages.join(', ')}.`, async () => {
    const languages = p.languages.length ? p.languages : ['en'];
    const generated = await paid(
      ctx,
      'generate',
      'campaign_draft',
      undefined,
      () => generateIdeas({ facts: strategy.facts, platforms: p.platforms, languages, count: p.postsPerDay, objective: p.objective, recent: strategy.recent }),
      (v) => v.ideas.length === 0,
    );
    if (generated.ideas.length === 0) throw new Error('The model returned no usable posts. Nothing was charged.');
    if (languages.length > 1) {
      await paid(ctx, 'translate', 'translation', { units: languages.length - 1 }, async () => true);
    }
    return { summary: `Wrote ${generated.ideas.length} idea(s).`, value: generated };
  });
  if (!draft.ok) return draft.state;
  const { ideas, flags } = draft.value;
  return {
    status: 'DONE',
    activityId: draft.activityId,
    detail: `${ideas.length} idea(s), ${ideas.reduce((n, i) => n + i.items.length, 0)} post variants.${flags.length ? ' Input flagged as instruction-like; review before approving.' : ''}`,
    data: { ideas },
  };
}

async function stepImage(ctx: Ctx): Promise<StepState> {
  const strategy = data<StrategyData>(ctx, 'strategy')!;
  if (!strategy.types.includes('image')) return { status: 'SKIPPED', detail: 'Images are not requested for this pipeline.' };
  if (!getVideoStorageConfig().ok) return { status: 'SKIPPED', detail: 'Image storage is not configured, so no image was generated.' };
  const ideas = data<{ ideas: GeneratedIdea[] }>(ctx, 'generate')!.ideas;
  const prompt = ideas.find((i) => i.imagePrompt)?.imagePrompt;
  if (!prompt) return { status: 'SKIPPED', detail: 'The model did not provide an image prompt.' };
  const draft = await draftStep(
    ctx,
    'image',
    'CONTENT',
    'content.image',
    'Generate one image for the first idea.',
    async () => {
      const base64 = await paid(ctx, 'image', 'image', undefined, () => generateAdImage(prompt));
      const key = `content-pipeline/${ctx.run.id}/image-0.png`;
      await putVideoObject(key, Buffer.from(base64, 'base64'), 'image/png');
      return { summary: 'Image generated and stored.', value: key };
    },
    4,
  );
  if (!draft.ok) return draft.state;
  return {
    status: 'DONE',
    activityId: draft.activityId,
    detail: 'Image generated and stored privately (used as the video reference when a video is requested).',
    data: { key: draft.value },
  };
}

type VideoData = { phase: 'create' | 'poll' | 'release'; jobId?: string; jobKey?: string; releaseIds?: string[]; releaseActivityId?: string };

async function createJob(ctx: Ctx, prompt: string, imageKey: string | null, jobKey: string) {
  const request = { userId: ctx.pipeline.ownerUserId, mode: imageKey ? ('IMAGE' as const) : ('TEXT' as const), seconds: VIDEO_SECONDS, aspect: '16:9' as const };
  const outcome = await withMarketingCredits(
    {
      userId: ctx.pipeline.ownerUserId,
      projectId: ctx.pipeline.projectId,
      operation: 'video_per_second',
      params: { seconds: VIDEO_SECONDS },
      idempotencyKey: videoChargeKey(jobKey),
      scheduled: true,
      refType: 'ContentRun',
      refId: ctx.run.id,
      isFailure: (r: Awaited<ReturnType<typeof createVideoJob>>) => !r.ok,
    },
    () => createVideoJob({ ...request, prompt, inputImageKey: imageKey, idempotencyKey: jobKey }),
  );
  if (!outcome.ok) throw new Error(outcome.error);
  if (!outcome.value.ok) throw new Error(outcome.value.error);
  return outcome.value.jobId;
}

async function stepVideo(ctx: Ctx): Promise<StepState> {
  const strategy = data<StrategyData>(ctx, 'strategy')!;
  const current = ctx.steps.video;
  if (!current && !strategy.types.includes('video')) return { status: 'SKIPPED', detail: 'Video is not requested for this pipeline.' };
  const ideas = data<{ ideas: GeneratedIdea[] }>(ctx, 'generate')!.ideas;
  const prompt = ideas.find((i) => i.videoPrompt)?.videoPrompt ?? null;
  const imageKey = (ctx.steps.image?.data as { key?: string } | undefined)?.key ?? null;
  let vd: VideoData = (current?.data as VideoData | undefined) ?? { phase: 'create' };

  if (vd.phase === 'create') {
    if (!prompt) return { status: 'SKIPPED', detail: 'The model did not provide a video prompt.' };
    const jobKey = vd.jobKey ?? chargeKey(ctx, 'video');
    if (current?.status === 'AWAITING_APPROVAL') {
      const decision = await approvalOf(current.activityId);
      if (decision === 'pending') return current;
      if (decision === 'rejected') return { status: 'BLOCKED', activityId: current.activityId, detail: 'Video generation was rejected.' };
      const jobId = await createJob(ctx, prompt, imageKey, jobKey);
      if (current.activityId) await completeActivity(current.activityId, { summary: `Video job ${jobId} created after approval.` });
      vd = { phase: 'poll', jobId, jobKey };
      return { status: 'WAITING', activityId: current.activityId, detail: 'Video job created; waiting for it to render.', data: vd };
    }
    const plan = await planVideo({ userId: ctx.pipeline.ownerUserId, mode: imageKey ? 'IMAGE' : 'TEXT', seconds: VIDEO_SECONDS, aspect: '16:9' });
    if (!plan.ok) return { status: 'FAILED', detail: plan.error };
    let jobId: string | undefined;
    const result = await runAgentAction({
      scope: ctx.scope,
      agent: 'CONTENT',
      action: 'content.video.create',
      category: 'content_draft',
      input: `Create a ${VIDEO_SECONDS}s video job.`,
      estimatedCostCents: plan.plan.estimatedCostCents,
      idempotencyKey: activityKey(ctx, 'video'),
      payload: { runId: ctx.run.id },
      execute: async () => {
        jobId = await createJob(ctx, prompt, imageKey, jobKey);
        return { summary: `Video job ${jobId} created.`, costCents: plan.plan.estimatedCostCents };
      },
    });
    if (result.status === 'BLOCKED') return { status: 'BLOCKED', activityId: result.activityId, detail: result.reason };
    if (result.status === 'FAILED') return { status: 'FAILED', activityId: result.activityId, detail: result.error ?? 'Video job could not be created.' };
    if (!jobId) {
      return {
        status: 'AWAITING_APPROVAL',
        activityId: result.activityId,
        detail: 'Video generation spends credits and waits for your approval.',
        data: { phase: 'create', jobKey },
      };
    }
    return { status: 'WAITING', activityId: result.activityId, detail: 'Video job created; waiting for it to render.', data: { phase: 'poll', jobId, jobKey } };
  }

  if (vd.phase === 'poll') {
    const job = await prisma.videoJob.findUnique({ where: { id: vd.jobId! }, select: { status: true, outputKey: true, error: true } });
    if (!job) return { status: 'FAILED', detail: 'The video job no longer exists.', data: vd };
    const state = videoStepFromJob(job);
    if (state.status !== 'DONE') return { ...state, activityId: current?.activityId, data: vd };
    vd = { ...vd, phase: 'release' };
  }

  // Release phase: the video exists, so create the scheduled releases (gated like any publication).
  const item = ideas[0];
  const releaseData = await releasePhase(ctx, vd, item);
  return releaseData;
}

async function releasePhase(ctx: Ctx, vd: VideoData, idea: GeneratedIdea | undefined): Promise<StepState> {
  const current = ctx.steps.video;
  if (vd.releaseIds && current?.status === 'AWAITING_APPROVAL' && vd.phase === 'release') {
    const decision = await approvalOf(vd.releaseActivityId);
    if (decision === 'pending') return current;
    if (decision === 'rejected') return { status: 'BLOCKED', activityId: vd.releaseActivityId, detail: 'Video publication was rejected; releases stay unapproved.', data: vd };
    const failures: string[] = [];
    for (const id of vd.releaseIds) {
      const r = await approveRelease(ctx.pipeline.ownerUserId, id, ctx.now);
      if (!r.ok) failures.push(r.error);
    }
    if (vd.releaseActivityId) await completeActivity(vd.releaseActivityId, { summary: `Approved ${vd.releaseIds.length - failures.length} release(s).` });
    return failures.length
      ? { status: 'FAILED', detail: `Some releases could not be approved: ${failures[0]}`, data: vd }
      : { status: 'DONE', detail: `${vd.releaseIds.length} video release(s) approved.`, data: vd };
  }
  if (!idea) return { status: 'FAILED', detail: 'No idea to describe the video.', data: vd };
  const platforms = ctx.pipeline.platforms.filter((p) => (VIDEO_PLATFORMS as readonly string[]).includes(p) && isReleasePlatform(p));
  if (platforms.length === 0) return { status: 'DONE', detail: 'Video rendered; none of the selected platforms accept video releases.', data: vd };

  const verdict = await gate(ctx, 'social_post');
  const create = async (approve: boolean) => {
    const slots = planSlots({ date: ctx.run.runDate, times: ctx.pipeline.preferredPostTimes, count: 1, timeZone: ctx.pipeline.timeZone, now: ctx.now });
    const scheduledAt = slots[0];
    const ids: string[] = [];
    const strategy = data<StrategyData>(ctx, 'strategy')!;
    for (const language of ctx.pipeline.languages.length ? ctx.pipeline.languages : ['en']) {
      for (const platform of platforms) {
        const variant = idea.items.find((i) => i.platform === platform && i.language === language) ?? idea.items.find((i) => i.language === language) ?? idea.items[0];
        const title = idea.idea.slice(0, 100);
        if (validateReleaseText(platform as never, title, variant.text, variant.hashtags).length) continue;
        if (validateGeneratedPost({ platform, text: variant.text, hashtags: variant.hashtags, siteUrl: strategy.siteUrl, previous: [] }).length) continue;
        const key = releaseIdempotencyKey({ userId: ctx.pipeline.ownerUserId, jobId: vd.jobId!, platform, language, scheduledAt });
        await prisma.videoRelease.createMany({
          data: [
            {
              userId: ctx.pipeline.ownerUserId,
              jobId: vd.jobId!,
              platform: platform as never,
              language,
              title,
              caption: variant.text,
              hashtags: variant.hashtags,
              scheduledAt,
              timeZone: ctx.pipeline.timeZone,
              status: 'SCHEDULED',
              idempotencyKey: key,
              seriesKey: `cp-${ctx.run.id}`,
            },
          ],
          skipDuplicates: true,
        });
        const row = await prisma.videoRelease.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (row) ids.push(row.id);
      }
    }
    if (approve) for (const id of ids) await approveRelease(ctx.pipeline.ownerUserId, id, ctx.now);
    return ids;
  };

  let ids: string[] | undefined;
  const result = await runAgentAction({
    scope: ctx.scope,
    agent: 'CONTENT',
    action: 'content.video.release',
    category: ctx.pipeline.autoPublishCategories.includes('social_post') ? 'social_post' : 'social_post_review',
    input: `Schedule the rendered video on ${platforms.join(', ')}.`,
    idempotencyKey: activityKey(ctx, 'video-release'),
    payload: { runId: ctx.run.id, jobId: vd.jobId },
    execute: async () => {
      ids = await create(verdict.approve);
      return { summary: `${ids.length} video release(s) ${verdict.approve ? 'approved' : 'scheduled'}.` };
    },
  });
  if (result.status === 'BLOCKED') return { status: 'BLOCKED', activityId: result.activityId, detail: result.reason, data: vd };
  if (result.status === 'FAILED') return { status: 'FAILED', activityId: result.activityId, detail: result.error ?? 'Could not create releases.', data: vd };
  if (!ids) ids = await create(false);
  const next: VideoData = { ...vd, phase: 'release', releaseIds: ids, releaseActivityId: result.activityId };
  if (ids.length === 0) return { status: 'FAILED', detail: 'No video release passed validation.', data: next };
  return result.status === 'DONE' && verdict.approve
    ? { status: 'DONE', activityId: result.activityId, detail: `${ids.length} video release(s) approved for publishing.`, data: next }
    : { status: 'AWAITING_APPROVAL', activityId: result.activityId, detail: `${ids.length} video release(s) waiting for your approval.`, data: next };
}

type ValidateData = { accepted: Item[]; rejected: { ideaIndex: number; platform: string; language: string; problems: string[] }[] };

async function stepValidate(ctx: Ctx): Promise<StepState> {
  const strategy = data<StrategyData>(ctx, 'strategy')!;
  const ideas = data<{ ideas: GeneratedIdea[] }>(ctx, 'generate')!.ideas;
  const draft = await draftStep(ctx, 'validate', 'CONTENT', 'content.validate', 'Check length, claims, links and duplicates.', async () => {
    const accepted: Item[] = [];
    const rejected: ValidateData['rejected'] = [];
    ideas.forEach((idea, ideaIndex) => {
      for (const item of idea.items) {
        const others = accepted.filter((a) => a.ideaIndex !== ideaIndex).map((a) => a.text);
        const problems = validateGeneratedPost({
          platform: item.platform,
          text: item.text,
          hashtags: item.hashtags,
          siteUrl: strategy.siteUrl,
          previous: [...strategy.recent, ...others],
          maxLength: ctx.scope.type === 'PLATFORM' ? HOUSE_MAX_LENGTH : undefined,
        });
        if (ctx.scope.type === 'PLATFORM' && !item.text.includes('appweaverai.com')) problems.push('House posts must link to appweaverai.com.');
        if (problems.length) rejected.push({ ideaIndex, platform: item.platform, language: item.language, problems });
        else accepted.push({ ...item, ideaIndex });
      }
    });
    return { summary: `${accepted.length} accepted, ${rejected.length} rejected.`, value: { accepted, rejected } as ValidateData };
  });
  if (!draft.ok) return draft.state;
  const { accepted, rejected } = draft.value;
  if (accepted.length === 0) {
    return { status: 'FAILED', activityId: draft.activityId, detail: `No post passed validation (${rejected[0]?.problems[0] ?? 'unknown reason'}).`, data: draft.value };
  }
  return { status: 'DONE', activityId: draft.activityId, detail: `${accepted.length} accepted, ${rejected.length} rejected.`, data: draft.value as unknown as Record<string, unknown> };
}

type ScheduleData = { kind: 'ProjectPost' | 'SocialPost'; ids: string[]; approved: boolean };

async function projectPostStatus(ownerUserId: string, platform: string): Promise<'SCHEDULED' | 'MANUAL'> {
  const connected = isAutoPublishPlatform(platform as Platform)
    ? Boolean(
        await prisma.socialConnection.findUnique({
          where: { userId_platform: { userId: ownerUserId, platform: connectionPlatform(platform) as 'X' | 'LINKEDIN' | 'FACEBOOK' } },
          select: { id: true },
        }),
      )
    : false;
  return approvedStatus(platform as Platform, connected, null);
}

async function createRows(ctx: Ctx, items: Item[], approve: boolean): Promise<ScheduleData> {
  const p = ctx.pipeline;
  const count = Math.max(...items.map((i) => i.ideaIndex)) + 1;
  const slots = planSlots({ date: ctx.run.runDate, times: p.preferredPostTimes, count, timeZone: p.timeZone, now: ctx.now });
  if (ctx.scope.type === 'PLATFORM') {
    const marker = `[cp-${ctx.run.id.slice(-8)}]`;
    const existing = await prisma.socialPost.findMany({ where: { title: { startsWith: marker } }, select: { id: true, status: true } });
    if (existing.length) return { kind: 'SocialPost', ids: existing.map((e) => e.id), approved: existing.every((e) => e.status !== 'DRAFT') };
    const ids: string[] = [];
    for (const item of items) {
      const row = await prisma.socialPost.create({
        data: {
          title: `${marker} ${item.platform}/${item.language}`,
          message: composePostText(item.text, item.hashtags),
          platforms: [item.platform],
          status: approve ? 'PENDING' : 'DRAFT',
          scheduledFor: slots[item.ideaIndex],
        },
      });
      ids.push(row.id);
    }
    return { kind: 'SocialPost', ids, approved: approve };
  }
  const projectId = p.projectId!;
  const name = `Daily content ${ctx.run.runDate}`;
  let campaign = await prisma.projectCampaign.findFirst({ where: { projectId, userId: p.ownerUserId, name }, select: { id: true } });
  if (!campaign) campaign = await prisma.projectCampaign.create({ data: { projectId, userId: p.ownerUserId, name, brief: p.objective }, select: { id: true } });
  const existing = await prisma.projectPost.findMany({ where: { campaignId: campaign.id }, select: { id: true, status: true } });
  if (existing.length) return { kind: 'ProjectPost', ids: existing.map((e) => e.id), approved: existing.every((e) => e.status !== 'DRAFT') };
  const ids: string[] = [];
  for (const item of items) {
    const status = approve ? await projectPostStatus(p.ownerUserId, item.platform) : 'DRAFT';
    const row = await prisma.projectPost.create({
      data: {
        campaignId: campaign.id,
        platform: item.platform as never,
        text: item.text,
        hashtags: item.hashtags,
        scheduledAt: slots[item.ideaIndex],
        timeZone: p.timeZone,
        status,
      },
    });
    ids.push(row.id);
  }
  await syncCampaignStatus(campaign.id).catch(() => undefined);
  return { kind: 'ProjectPost', ids, approved: approve };
}

async function approveRows(ctx: Ctx, sd: ScheduleData) {
  if (sd.kind === 'SocialPost') {
    await prisma.socialPost.updateMany({ where: { id: { in: sd.ids }, status: 'DRAFT' }, data: { status: 'PENDING' } });
    return;
  }
  const posts = await prisma.projectPost.findMany({ where: { id: { in: sd.ids }, status: 'DRAFT' }, select: { id: true, platform: true, campaignId: true } });
  for (const post of posts) {
    await prisma.projectPost.updateMany({
      where: { id: post.id, status: 'DRAFT' },
      data: { status: await projectPostStatus(ctx.pipeline.ownerUserId, post.platform) },
    });
  }
  const campaigns = [...new Set(posts.map((x) => x.campaignId))];
  for (const id of campaigns) await syncCampaignStatus(id).catch(() => undefined);
}

async function stepSchedule(ctx: Ctx): Promise<StepState> {
  const current = ctx.steps.schedule;
  const sd = current?.data as ScheduleData | undefined;
  if (current?.status === 'AWAITING_APPROVAL' && sd) {
    const decision = await approvalOf(current.activityId);
    if (decision === 'pending') return current;
    if (decision === 'rejected') return { status: 'BLOCKED', activityId: current.activityId, detail: 'Rejected: the drafts were left unapproved.', data: sd };
    await approveRows(ctx, sd);
    if (current.activityId) await completeActivity(current.activityId, { summary: `Approved ${sd.ids.length} post(s).` });
    return { status: 'DONE', activityId: current.activityId, detail: `${sd.ids.length} post(s) approved after your decision.`, data: { ...sd, approved: true } };
  }
  const items = data<ValidateData>(ctx, 'validate')?.accepted ?? [];
  if (!items.length) return { status: 'SKIPPED', detail: 'Nothing validated to schedule.' };

  const verdict = await gate(ctx, 'social_post');
  let created: ScheduleData | undefined;
  const result = await runAgentAction({
    scope: ctx.scope,
    agent: 'CONTENT',
    action: 'content.schedule',
    category: ctx.pipeline.autoPublishCategories.includes('social_post') ? 'social_post' : 'social_post_review',
    input: `Schedule ${items.length} post(s) for ${ctx.run.runDate}.`,
    idempotencyKey: activityKey(ctx, 'schedule'),
    payload: { runId: ctx.run.id },
    execute: async () => {
      created = await createRows(ctx, items, verdict.approve);
      return { summary: `${created.ids.length} post(s) ${verdict.approve ? 'approved and scheduled' : 'scheduled as drafts'}.` };
    },
  });
  if (result.status === 'BLOCKED') return { status: 'BLOCKED', activityId: result.activityId, detail: result.reason };
  if (result.status === 'FAILED') return { status: 'FAILED', activityId: result.activityId, detail: result.error ?? 'Scheduling failed.' };
  if (!created) created = await createRows(ctx, items, false);
  if (created.approved) {
    return { status: 'DONE', activityId: result.activityId, detail: `${created.ids.length} post(s) approved and scheduled.`, data: created };
  }
  return {
    status: 'AWAITING_APPROVAL',
    activityId: result.activityId,
    detail: `${created.ids.length} draft(s) wait for your approval (${verdict.reason}).`,
    data: created,
  };
}

/** Reads the real status of the rows created earlier; never publishes anything itself. */
export async function buildReport(ctx: Pick<Ctx, 'steps'>): Promise<StepState> {
  const sd = ctx.steps.schedule?.data as ScheduleData | undefined;
  const vd = ctx.steps.video?.data as VideoData | undefined;
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  const add = (status: string, error?: string | null) => {
    counts[status] = (counts[status] ?? 0) + 1;
    if (error && (status === 'FAILED' || status === 'MANUAL')) failures.push(error.slice(0, 160));
  };
  if (sd?.kind === 'SocialPost') {
    for (const r of await prisma.socialPost.findMany({ where: { id: { in: sd.ids } }, select: { status: true } })) add(r.status);
  } else if (sd?.kind === 'ProjectPost') {
    for (const r of await prisma.projectPost.findMany({ where: { id: { in: sd.ids } }, select: { status: true, error: true } })) add(r.status, r.error);
  }
  if (vd?.releaseIds?.length) {
    for (const r of await prisma.videoRelease.findMany({ where: { id: { in: vd.releaseIds } }, select: { status: true, error: true } })) add(`VIDEO_${r.status}`, r.error);
  }
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase().replace('_', ' ')}`);
  return {
    status: 'DONE',
    at: iso(),
    detail: parts.length ? parts.join(', ') : 'Nothing was scheduled.',
    data: { counts, failures: failures.slice(0, 5) },
  };
}

async function stepReport(ctx: Ctx): Promise<StepState> {
  return buildReport(ctx);
}

/** Refreshes the publish-result snapshot of recently finished runs (rows publish hours after the run). */
async function refreshReports(now: Date) {
  const runs = await prisma.contentRun.findMany({
    where: { status: { in: ['SUCCEEDED', 'PARTIAL', 'WAITING'] }, finishedAt: { gte: new Date(now.getTime() - 48 * 3_600_000) } },
    take: 50,
  });
  for (const run of runs) {
    const steps = { ...(run.steps as StepMap) };
    if (!steps.schedule?.data && !steps.video?.data) continue;
    steps.report = await buildReport({ steps });
    await prisma.contentRun.update({ where: { id: run.id }, data: { steps: json(steps) } }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Cron entry
// ---------------------------------------------------------------------------

export type TickResult = { advanced: number; started: number; skipped: number; errors: string[] };

/** Hourly: resumes open runs (video waits, approvals, crash recovery), then starts the runs that are due. */
export async function runContentPipelines(now = new Date()): Promise<TickResult> {
  const out: TickResult = { advanced: 0, started: 0, skipped: 0, errors: [] };
  const seen = new Set<string>();
  const attempt = async (id: string, date: string, started: boolean) => {
    const key = `${id}:${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const r = await advanceRun(id, date, { trigger: 'cron', now });
      if (r.skipped) out.skipped += 1;
      else if (started) out.started += 1;
      else out.advanced += 1;
    } catch (error) {
      out.errors.push(`${id}: ${message(error)}`);
    }
  };

  const open = await prisma.contentRun.findMany({
    where: { status: { in: ['RUNNING', 'WAITING'] }, pipeline: { enabled: true, paused: false } },
    select: { pipelineId: true, runDate: true },
    take: 100,
  });
  for (const run of open) await attempt(run.pipelineId, run.runDate, false);

  const pipelines = await prisma.contentPipeline.findMany({ where: { enabled: true, paused: false }, take: 500 });
  for (const pipeline of pipelines) {
    const date = dueRunDate(pipeline, now);
    if (date) await attempt(pipeline.id, date, true);
  }
  await refreshReports(now).catch((error) => out.errors.push(`reports: ${message(error)}`));
  return out;
}

/** Owner "Run now": runs today's (local) run immediately, retrying a failed one. */
export async function runPipelineNow(pipelineId: string, now = new Date()) {
  const pipeline = await prisma.contentPipeline.findUnique({ where: { id: pipelineId } });
  if (!pipeline) return { status: 'skipped', skipped: 'Pipeline not found.' } as AdvanceResult;
  return advanceRun(pipelineId, localParts(now, pipeline.timeZone).date, { trigger: 'manual', now, force: true });
}

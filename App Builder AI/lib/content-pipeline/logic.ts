import { isValidTimeZone, zonedTimeToUtc } from '@/lib/ads/schedule';
import { decide } from '@/lib/agents/policy';
import type { AgentModeName } from '@/lib/agents/types';
import { composePostText, MAX_TEXT, type Platform } from '@/lib/project-marketing/constants';
import { isSafeAdText } from '@/lib/social/adverts';

import {
  CONTENT_TYPES,
  CUSTOMER_SCOPE_PLATFORMS,
  MAX_POSTS_PER_DAY,
  PIPELINE_CATEGORIES,
  PLATFORM_SCOPE_PLATFORMS,
  SUPPORTED_LANGUAGES,
  VIDEO_SECONDS,
  type PipelineConfig,
  type PipelineStep,
  type StepMap,
  type StepState,
} from './types';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHHMM = (value: string) => HHMM.test(value);

/** Local calendar date and time of an instant in a zone. */
export function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export type DueInput = { enabled: boolean; paused: boolean; timeOfDay: string; timeZone: string; lastRunAt?: Date | null };

/**
 * The local run date (YYYY-MM-DD) a pipeline owes at `now`, or null. A pipeline is due from its
 * local time of day until midnight, so a run missed (restart, outage) is still recovered the same day.
 */
export function dueRunDate(pipeline: DueInput, now = new Date()): string | null {
  if (!pipeline.enabled || pipeline.paused) return null;
  if (!isHHMM(pipeline.timeOfDay) || !isValidTimeZone(pipeline.timeZone)) return null;
  const local = localParts(now, pipeline.timeZone);
  if (local.time < pipeline.timeOfDay) return null;
  if (pipeline.lastRunAt && localParts(pipeline.lastRunAt, pipeline.timeZone).date === local.date) return null;
  return local.date;
}

/** Overlapping word shingles used for near-duplicate detection. */
export function shingles(text: string, size = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= size) return new Set(words.length ? [words.join(' ')] : []);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) out.add(words.slice(i, i + size).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.5;

/** Returns the most similar earlier text when it is a near duplicate. */
export function findDuplicate(text: string, previous: readonly string[], threshold = DUPLICATE_THRESHOLD) {
  const mine = shingles(text);
  let best: { index: number; score: number } | null = null;
  previous.forEach((other, index) => {
    const score = jaccard(mine, shingles(other));
    if (score >= threshold && (!best || score > best.score)) best = { index, score };
  });
  return best as { index: number; score: number } | null;
}

export type ValidateInput = {
  platform: string;
  text: string;
  hashtags: string[];
  /** Only this site may be linked; no link is allowed when null. */
  siteUrl: string | null;
  previous: readonly string[];
  /** Hard cap overriding the platform default (house posts must fit every platform). */
  maxLength?: number;
};

/** Everything that must hold before a generated post may be scheduled. Empty list = valid. */
export function validateGeneratedPost(input: ValidateInput): string[] {
  const problems: string[] = [];
  const body = input.text.trim();
  if (!body) return ['Post text is empty.'];
  const limit = input.maxLength ?? MAX_TEXT[input.platform as Platform] ?? 280;
  if (composePostText(body, input.hashtags).length > limit) problems.push(`Longer than ${limit} characters including hashtags.`);
  if (!isSafeAdText(body)) problems.push('Contains a banned or unprovable claim.');
  let allowed: string | null = null;
  try {
    allowed = input.siteUrl ? new URL(input.siteUrl).hostname : null;
  } catch {
    allowed = null;
  }
  for (const url of body.match(/https?:\/\/[^\s)]+/g) ?? []) {
    try {
      if (!allowed || new URL(url).hostname !== allowed) problems.push(`Link ${url} is not the product's own site.`);
    } catch {
      problems.push('Contains an invalid link.');
    }
  }
  const dup = findDuplicate(body, input.previous);
  if (dup) problems.push(`Too similar to an earlier post (${Math.round(dup.score * 100)}% overlap).`);
  return problems;
}

const DEFAULT_TIMES = ['10:00', '14:00', '18:00'];

/** One UTC publish time per post, from the preferred local times; never in the past. */
export function planSlots(input: { date: string; times: string[]; count: number; timeZone: string; now?: Date }): Date[] {
  const now = input.now ?? new Date();
  const times = [...new Set(input.times.filter(isHHMM))].sort();
  const usable = times.length ? times : DEFAULT_TIMES;
  const slots: Date[] = [];
  for (let i = 0; i < input.count; i += 1) {
    let at: Date | null;
    if (i < usable.length) {
      at = zonedTimeToUtc(`${input.date}T${usable[i]}`, input.timeZone);
    } else {
      const base = zonedTimeToUtc(`${input.date}T${usable[usable.length - 1]}`, input.timeZone);
      at = base ? new Date(base.getTime() + (i - usable.length + 1) * 45 * 60_000) : null;
    }
    const floor = now.getTime() + (i + 1) * 10 * 60_000;
    slots.push(!at || at.getTime() < floor ? new Date(floor) : at);
  }
  return slots;
}

export type GateInput = {
  mode: AgentModeName;
  enabled: boolean;
  paused: boolean;
  /** Categories the owner allowed to run autonomously (agent settings). */
  agentCategories: readonly string[];
  /** Categories this pipeline is additionally allowed to auto-approve. */
  pipelineCategories: readonly string[];
  category: string;
  scope: 'PLATFORM' | 'PROJECT';
  withinLimits?: boolean;
  globalPause?: boolean;
};

/** Rows are approved only when the agent policy says EXECUTE and the pipeline also allows the category. */
export function gateApproval(input: GateInput): { approve: boolean; outcome: string; reason: string } {
  const allowed = input.agentCategories.filter((c) => input.pipelineCategories.includes(c));
  const decision = decide({
    mode: input.mode,
    enabled: input.enabled,
    paused: input.paused,
    category: input.category,
    actionRisk: 'LOW',
    withinLimits: input.withinLimits ?? true,
    globalPause: input.globalPause ?? false,
    autonomousCategories: allowed,
    scope: input.scope,
  });
  return { approve: decision.outcome === 'EXECUTE', outcome: decision.outcome, reason: decision.reason };
}

/** Maps a real video job to the pipeline step; never reports success without an output file. */
export function videoStepFromJob(job: { status: string; outputKey: string | null; error?: string | null }): Pick<StepState, 'status' | 'detail'> {
  switch (job.status) {
    case 'SUCCEEDED':
      return job.outputKey ? { status: 'DONE', detail: 'Video rendered.' } : { status: 'FAILED', detail: 'Video job finished without an output file.' };
    case 'FAILED':
      return { status: 'FAILED', detail: job.error?.slice(0, 300) || 'Video generation failed.' };
    case 'CANCELLED':
      return { status: 'FAILED', detail: 'Video job was cancelled.' };
    default:
      return { status: 'WAITING', detail: `Video job is ${job.status.toLowerCase()}.` };
  }
}

export type RunStatus = 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export function runStatusFromSteps(steps: StepMap, finished: boolean): RunStatus {
  const states = Object.values(steps) as StepState[];
  if (states.some((s) => s.status === 'WAITING' || s.status === 'AWAITING_APPROVAL')) return 'WAITING';
  if (!finished) return 'RUNNING';
  const bad = states.some((s) => s.status === 'FAILED' || s.status === 'BLOCKED');
  const good = states.some((s) => s.status === 'DONE' || s.status === 'AWAITING_APPROVAL');
  if (!bad) return 'SUCCEEDED';
  return good ? 'PARTIAL' : 'FAILED';
}

export function isTerminal(status: string) {
  return status === 'SUCCEEDED' || status === 'PARTIAL' || status === 'FAILED';
}

type Prices = Partial<Record<'text_post' | 'campaign_draft' | 'translation' | 'image' | 'video_per_second', number>>;

/** Estimated marketing credits for one run (customer scope; the platform scope costs zero customer credits). */
export function estimateDailyCredits(
  config: Pick<PipelineConfigLike, 'postsPerDay' | 'languages' | 'contentTypes'>,
  prices: Prices,
): number {
  const types = new Set(config.contentTypes);
  const extraLanguages = Math.max(0, config.languages.length - 1);
  let total = prices.campaign_draft ?? 0;
  total += (prices.translation ?? 0) * extraLanguages;
  if (types.has('image')) total += (prices.image ?? 0) * config.postsPerDay;
  if (types.has('video')) total += (prices.video_per_second ?? 0) * VIDEO_SECONDS;
  return Math.round(total);
}

type PipelineConfigLike = { postsPerDay: number; languages: string[]; contentTypes: string[] };

export function stepDone(step: PipelineStep, steps: StepMap) {
  const status = steps[step]?.status;
  return status === 'DONE' || status === 'SKIPPED' || status === 'AWAITING_APPROVAL';
}

export type ConfigResult = { ok: true; value: PipelineConfig } | { ok: false; error: string };

/** Validates owner/admin input; anything outside the allowed sets is rejected rather than silently dropped. */
export function normalizeConfig(input: Partial<Record<keyof PipelineConfig, unknown>>, scope: 'PLATFORM' | 'PROJECT'): ConfigResult {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const timeOfDay = typeof input.timeOfDay === 'string' ? input.timeOfDay : '';
  if (!isHHMM(timeOfDay)) return { ok: false, error: 'Run time must be HH:MM.' };
  const timeZone = typeof input.timeZone === 'string' ? input.timeZone : '';
  if (!isValidTimeZone(timeZone)) return { ok: false, error: 'Invalid time zone.' };
  const postsPerDay = Number(input.postsPerDay);
  if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > MAX_POSTS_PER_DAY) {
    return { ok: false, error: `Posts per day must be between 1 and ${MAX_POSTS_PER_DAY}.` };
  }
  const allowedPlatforms: readonly string[] = scope === 'PLATFORM' ? PLATFORM_SCOPE_PLATFORMS : CUSTOMER_SCOPE_PLATFORMS;
  const platforms = [...new Set(strings(input.platforms))];
  if (platforms.length === 0 || platforms.some((p) => !allowedPlatforms.includes(p))) return { ok: false, error: 'Choose at least one supported platform.' };
  const languages = [...new Set(strings(input.languages))];
  if (languages.length === 0 || languages.length > 4 || languages.some((l) => !(l in SUPPORTED_LANGUAGES))) {
    return { ok: false, error: 'Choose 1 to 4 supported languages.' };
  }
  const types = new Set(strings(input.contentTypes));
  if ([...types].some((t) => !(CONTENT_TYPES as readonly string[]).includes(t))) return { ok: false, error: 'Unknown content type.' };
  types.add('post');
  const times = [...new Set(strings(input.preferredPostTimes))];
  if (times.length > 6 || times.some((t) => !isHHMM(t))) return { ok: false, error: 'Preferred post times must be HH:MM (at most 6).' };
  const categories = [...new Set(strings(input.autoPublishCategories))];
  if (categories.some((c) => !(PIPELINE_CATEGORIES as readonly string[]).includes(c))) return { ok: false, error: 'Unknown category.' };
  const maxDailyCredits = Number(input.maxDailyCredits ?? 0);
  if (!Number.isInteger(maxDailyCredits) || maxDailyCredits < 0 || maxDailyCredits > 10_000) return { ok: false, error: 'Daily credit cap must be 0 to 10000.' };
  const objective = typeof input.objective === 'string' ? input.objective.trim().slice(0, 500) : '';
  return {
    ok: true,
    value: {
      enabled: Boolean(input.enabled),
      timeOfDay,
      timeZone,
      postsPerDay,
      platforms,
      languages,
      contentTypes: [...types],
      preferredPostTimes: times.sort(),
      autoPublishCategories: categories,
      objective,
      maxDailyCredits,
    },
  };
}

import type {
  VideoAspect,
  VideoCapabilities,
  VideoMode,
  VideoProvider,
} from './providers/types';

export type SelectionPriority = 'cost' | 'quality' | 'balanced';

export type SelectionRequirements = {
  mode: VideoMode;
  seconds: number;
  aspect: VideoAspect;
  priority?: SelectionPriority;
  model?: string;
};

export type SelectionCandidate = {
  provider: Pick<VideoProvider, 'id' | 'capabilities' | 'estimateCostCents'>;
  enabled: boolean;
  /** Credentials and storage present (VideoProvider.isConfigured). */
  available: boolean;
  /** Admin per-job cap, if any. */
  maxSecondsPerJob?: number;
  /** Budget left this month, in cents; undefined means unlimited. */
  remainingBudgetCents?: number;
  /** Jobs still allowed today; undefined means unlimited. */
  remainingDailyJobs?: number;
};

export type RejectionReason =
  | 'disabled'
  | 'not-configured'
  | 'mode-unsupported'
  | 'aspect-unsupported'
  | 'duration-unsupported'
  | 'over-job-limit'
  | 'budget-exhausted'
  | 'daily-limit';

export type SelectionResult =
  | {
      ok: true;
      providerId: string;
      estimatedCostCents: number;
      ranked: Array<{ providerId: string; estimatedCostCents: number }>;
    }
  | {
      ok: false;
      reason: RejectionReason | 'no-providers';
      rejections: Array<{ providerId: string; reason: RejectionReason }>;
    };

export function supportsMode(capabilities: VideoCapabilities, mode: VideoMode) {
  if (mode === 'TEXT') return capabilities.textToVideo;
  if (mode === 'IMAGE') return capabilities.imageToVideo;
  return capabilities.videoToVideo;
}

export function supportsDuration(capabilities: VideoCapabilities, mode: VideoMode, seconds: number) {
  const max =
    mode === 'IMAGE'
      ? (capabilities.imageToVideoMaxSeconds ?? capabilities.maxSeconds)
      : capabilities.maxSeconds;
  if (!Number.isInteger(seconds) || seconds < capabilities.minSeconds || seconds > max) return false;
  return (seconds - capabilities.minSeconds) % capabilities.secondsStep === 0;
}

function rejectionFor(
  candidate: SelectionCandidate,
  need: SelectionRequirements,
  cost: number,
): RejectionReason | null {
  const caps = candidate.provider.capabilities;
  if (!candidate.enabled) return 'disabled';
  if (!candidate.available) return 'not-configured';
  if (!supportsMode(caps, need.mode)) return 'mode-unsupported';
  if (!caps.aspectRatios.includes(need.aspect)) return 'aspect-unsupported';
  if (!supportsDuration(caps, need.mode, need.seconds)) return 'duration-unsupported';
  if (candidate.maxSecondsPerJob !== undefined && need.seconds > candidate.maxSecondsPerJob) {
    return 'over-job-limit';
  }
  if (candidate.remainingDailyJobs !== undefined && candidate.remainingDailyJobs <= 0) {
    return 'daily-limit';
  }
  if (candidate.remainingBudgetCents !== undefined && cost > candidate.remainingBudgetCents) {
    return 'budget-exhausted';
  }
  return null;
}

/**
 * Picks the best provider for a request. Pure: all state (enabled flags,
 * budgets, availability) comes in through `candidates`.
 * "cost" = cheapest first, "quality" = best quality first, "balanced" mixes both;
 * ties always fall back to the other criterion and then the provider id.
 */
export function selectVideoProvider(
  need: SelectionRequirements,
  candidates: SelectionCandidate[],
): SelectionResult {
  if (candidates.length === 0) return { ok: false, reason: 'no-providers', rejections: [] };

  const rejections: Array<{ providerId: string; reason: RejectionReason }> = [];
  const eligible: Array<{ id: string; cost: number; quality: number }> = [];

  for (const candidate of candidates) {
    const cost = candidate.provider.estimateCostCents({
      mode: need.mode,
      seconds: need.seconds,
      model: need.model,
    });
    const reason = rejectionFor(candidate, need, cost);
    if (reason) rejections.push({ providerId: candidate.provider.id, reason });
    else {
      eligible.push({
        id: candidate.provider.id,
        cost,
        quality: candidate.provider.capabilities.qualityScore,
      });
    }
  }

  if (eligible.length === 0) {
    // Report the reason most providers share (first one on a tie).
    const counts = new Map<RejectionReason, number>();
    for (const item of rejections) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'disabled';
    return { ok: false, reason: top, rejections };
  }

  const priority = need.priority ?? 'balanced';
  const costs = eligible.map((item) => item.cost);
  const minCost = Math.min(...costs);
  const spread = Math.max(...costs) - minCost;
  const score = (item: { cost: number; quality: number }) => {
    const quality = item.quality / 10;
    const cheapness = spread === 0 ? 1 : 1 - (item.cost - minCost) / spread;
    if (priority === 'cost') return cheapness * 100 + quality;
    if (priority === 'quality') return quality * 100 + cheapness;
    return quality * 0.5 + cheapness * 0.5;
  };

  const ranked = [...eligible].sort(
    (a, b) => score(b) - score(a) || a.cost - b.cost || a.id.localeCompare(b.id),
  );
  return {
    ok: true,
    providerId: ranked[0].id,
    estimatedCostCents: ranked[0].cost,
    ranked: ranked.map((item) => ({ providerId: item.id, estimatedCostCents: item.cost })),
  };
}

export const REJECTION_MESSAGES: Record<RejectionReason | 'no-providers', string> = {
  'no-providers': 'No video providers are registered.',
  disabled: 'Video generation is not enabled yet.',
  'not-configured': 'Video generation is not configured on this server.',
  'mode-unsupported': 'No enabled provider supports this kind of video.',
  'aspect-unsupported': 'No enabled provider supports this aspect ratio.',
  'duration-unsupported': 'No enabled provider supports this duration.',
  'over-job-limit': 'This clip is longer than the per-video limit.',
  'budget-exhausted': 'The monthly video budget has been reached.',
  'daily-limit': 'The daily video limit has been reached. Try again tomorrow.',
};

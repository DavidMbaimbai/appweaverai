export const VIDEO_QUOTA_FREE_MONTHLY = 3;
export const VIDEO_QUOTA_PAID_MONTHLY = 60;
export const VIDEO_MAX_ATTEMPTS = 3;
export const VIDEO_RUN_TIMEOUT_MS = 45 * 60 * 1000;

export function monthlyVideoQuota(plan: string | null | undefined): number {
  return !plan || plan === 'free' ? VIDEO_QUOTA_FREE_MONTHLY : VIDEO_QUOTA_PAID_MONTHLY;
}

export type QuotaInput = {
  plan: string | null | undefined;
  /** User's videos this calendar month, excluding failed/cancelled ones. */
  userVideosThisMonth: number;
  seconds: number;
  estimatedCostCents: number;
  config: {
    enabled: boolean;
    maxSecondsPerJob: number;
    dailyJobLimit: number;
    monthlyBudgetCents: number;
  };
  /** Provider-wide usage: today's job count and this month's spend (estimated + actual). */
  providerJobsToday: number;
  providerSpentThisMonthCents: number;
};

export type QuotaResult =
  | { ok: true }
  | {
      ok: false;
      code: 'disabled' | 'user-quota' | 'job-limit' | 'daily-limit' | 'budget';
      message: string;
    };

export function checkVideoQuota(input: QuotaInput): QuotaResult {
  const { config } = input;
  if (!config.enabled) {
    return { ok: false, code: 'disabled', message: 'Video generation is not enabled yet.' };
  }
  const quota = monthlyVideoQuota(input.plan);
  if (input.userVideosThisMonth >= quota) {
    const upgrade = quota === VIDEO_QUOTA_FREE_MONTHLY ? ' Upgrade for more.' : '';
    return {
      ok: false,
      code: 'user-quota',
      message: `You have used all ${quota} videos for this month.${upgrade}`,
    };
  }
  if (input.seconds > config.maxSecondsPerJob) {
    return {
      ok: false,
      code: 'job-limit',
      message: `Videos are limited to ${config.maxSecondsPerJob} seconds each.`,
    };
  }
  if (input.providerJobsToday >= config.dailyJobLimit) {
    return {
      ok: false,
      code: 'daily-limit',
      message: 'The daily video limit has been reached. Try again tomorrow.',
    };
  }
  if (input.providerSpentThisMonthCents + input.estimatedCostCents > config.monthlyBudgetCents) {
    return {
      ok: false,
      code: 'budget',
      message: 'The monthly video budget has been reached. Try again next month.',
    };
  }
  return { ok: true };
}

/** Delay before retry number `attempts` (1-based): 1, 2, 4 minutes capped at 10. */
export function retryDelayMs(attempts: number): number {
  return Math.min(10, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/** Cron-run progress estimate when a provider reports none. Never reaches 100. */
export function estimateProgress(elapsedMs: number, seconds: number): number {
  // Nova Reel takes roughly 90 seconds per 6 seconds of output.
  const expectedMs = Math.max(60_000, (seconds / 6) * 90_000);
  return Math.max(1, Math.min(95, Math.round((elapsedMs / expectedMs) * 100)));
}

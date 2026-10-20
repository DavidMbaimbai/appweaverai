import { describe, expect, it } from 'vitest';

import { createNovaReelProvider } from '@/lib/video/providers/nova-reel';
import {
  getVideoProvider,
  listVideoProviders,
  registerVideoProvider,
  unregisterVideoProvider,
} from '@/lib/video/providers/registry';
import type { VideoCapabilities, VideoProvider } from '@/lib/video/providers/types';
import {
  checkVideoQuota,
  estimateProgress,
  monthlyVideoQuota,
  retryDelayMs,
} from '@/lib/video/quota';
import { selectVideoProvider, supportsDuration, type SelectionCandidate } from '@/lib/video/select';

const baseCaps: VideoCapabilities = {
  textToVideo: true,
  imageToVideo: true,
  videoToVideo: false,
  minSeconds: 5,
  secondsStep: 5,
  maxSeconds: 10,
  aspectRatios: ['16:9', '9:16'],
  qualityScore: 9,
};

function fake(id: string, centsPerSecond: number, caps: Partial<VideoCapabilities> = {}) {
  return {
    id,
    capabilities: { ...baseCaps, ...caps },
    estimateCostCents: ({ seconds }: { seconds: number }) => seconds * centsPerSecond,
  };
}

const nova = createNovaReelProvider({ client: { send: async () => ({}) } });
const novaCandidate = (over: Partial<SelectionCandidate> = {}): SelectionCandidate => ({
  provider: nova,
  enabled: true,
  available: true,
  ...over,
});
const need = { mode: 'TEXT' as const, seconds: 6, aspect: '16:9' as const };

describe('selectVideoProvider', () => {
  it('works with a single provider', () => {
    expect(selectVideoProvider(need, [novaCandidate()])).toMatchObject({
      ok: true,
      providerId: 'nova-reel',
      estimatedCostCents: 48,
    });
  });

  it('explains why nothing can run', () => {
    expect(selectVideoProvider(need, [novaCandidate({ enabled: false })])).toMatchObject({ ok: false, reason: 'disabled' });
    expect(selectVideoProvider(need, [novaCandidate({ available: false })])).toMatchObject({ ok: false, reason: 'not-configured' });
    expect(selectVideoProvider({ ...need, aspect: '9:16' }, [novaCandidate()])).toMatchObject({ ok: false, reason: 'aspect-unsupported' });
    expect(selectVideoProvider({ ...need, mode: 'VIDEO' }, [novaCandidate()])).toMatchObject({ ok: false, reason: 'mode-unsupported' });
    expect(selectVideoProvider({ ...need, seconds: 7 }, [novaCandidate()])).toMatchObject({ ok: false, reason: 'duration-unsupported' });
    expect(selectVideoProvider({ ...need, mode: 'IMAGE', seconds: 12 }, [novaCandidate()])).toMatchObject({ ok: false, reason: 'duration-unsupported' });
    expect(selectVideoProvider({ ...need, seconds: 12 }, [novaCandidate({ maxSecondsPerJob: 6 })])).toMatchObject({ ok: false, reason: 'over-job-limit' });
    expect(selectVideoProvider(need, [novaCandidate({ remainingBudgetCents: 10 })])).toMatchObject({ ok: false, reason: 'budget-exhausted' });
    expect(selectVideoProvider(need, [novaCandidate({ remainingDailyJobs: 0 })])).toMatchObject({ ok: false, reason: 'daily-limit' });
    expect(selectVideoProvider(need, [])).toMatchObject({ ok: false, reason: 'no-providers' });
  });

  it('ranks by cost, quality or a balance', () => {
    const cheap = { provider: fake('cheap', 2, { qualityScore: 4, minSeconds: 6, secondsStep: 6 }), enabled: true, available: true };
    const fancy = { provider: fake('fancy', 20, { qualityScore: 10, minSeconds: 6, secondsStep: 6 }), enabled: true, available: true };
    const mid = { provider: fake('mid', 8, { qualityScore: 8, minSeconds: 6, secondsStep: 6 }), enabled: true, available: true };
    const all = [fancy, cheap, mid];
    expect(selectVideoProvider({ ...need, priority: 'cost' }, all)).toMatchObject({ providerId: 'cheap' });
    expect(selectVideoProvider({ ...need, priority: 'quality' }, all)).toMatchObject({ providerId: 'fancy' });
    expect(selectVideoProvider({ ...need, priority: 'balanced' }, all)).toMatchObject({ providerId: 'mid' });
  });

  it('skips ineligible providers and falls back to another', () => {
    const other = { provider: fake('other', 5, { minSeconds: 6, secondsStep: 6 }), enabled: true, available: true };
    const result = selectVideoProvider(need, [novaCandidate({ enabled: false }), other]);
    expect(result).toMatchObject({ ok: true, providerId: 'other' });
  });

  it('checks durations against minimum, step and image limits', () => {
    expect(supportsDuration(nova.capabilities, 'TEXT', 6)).toBe(true);
    expect(supportsDuration(nova.capabilities, 'TEXT', 18)).toBe(true);
    expect(supportsDuration(nova.capabilities, 'TEXT', 120)).toBe(true);
    expect(supportsDuration(nova.capabilities, 'TEXT', 126)).toBe(false);
    expect(supportsDuration(nova.capabilities, 'TEXT', 9)).toBe(false);
    expect(supportsDuration(nova.capabilities, 'IMAGE', 12)).toBe(false);
  });
});

describe('provider registry', () => {
  it('ships Nova Reel and lets new providers be registered', () => {
    expect(listVideoProviders().map((p) => p.id)).toContain('nova-reel');
    const extra = { ...nova, id: 'extra-test', label: 'Extra' } as VideoProvider;
    registerVideoProvider(extra);
    expect(getVideoProvider('extra-test')).toBe(extra);
    unregisterVideoProvider('extra-test');
    expect(getVideoProvider('extra-test')).toBeUndefined();
  });
});

describe('video quota', () => {
  const config = { enabled: true, maxSecondsPerJob: 60, dailyJobLimit: 10, monthlyBudgetCents: 1000 };
  const input = {
    plan: 'free',
    userVideosThisMonth: 0,
    seconds: 6,
    estimatedCostCents: 48,
    config,
    providerJobsToday: 0,
    providerSpentThisMonthCents: 0,
  };

  it('gives free users 3 and paid users 60 videos a month', () => {
    expect(monthlyVideoQuota('free')).toBe(3);
    expect(monthlyVideoQuota('pro')).toBe(60);
    expect(checkVideoQuota({ ...input, userVideosThisMonth: 3 })).toMatchObject({ ok: false, code: 'user-quota' });
    expect(checkVideoQuota({ ...input, plan: 'pro', userVideosThisMonth: 3 })).toEqual({ ok: true });
    expect(checkVideoQuota({ ...input, plan: 'pro', userVideosThisMonth: 60 })).toMatchObject({ ok: false, code: 'user-quota' });
  });

  it('enforces provider switch, per-job, daily and budget limits', () => {
    expect(checkVideoQuota({ ...input, config: { ...config, enabled: false } })).toMatchObject({ code: 'disabled' });
    expect(checkVideoQuota({ ...input, seconds: 66 })).toMatchObject({ code: 'job-limit' });
    expect(checkVideoQuota({ ...input, providerJobsToday: 10 })).toMatchObject({ code: 'daily-limit' });
    expect(checkVideoQuota({ ...input, providerSpentThisMonthCents: 960 })).toMatchObject({ code: 'budget' });
    expect(checkVideoQuota({ ...input, providerSpentThisMonthCents: 952 })).toEqual({ ok: true });
  });

  it('backs off exponentially and never reports 100% progress while running', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelayMs)).toEqual([60, 120, 240, 480, 600, 600].map((s) => s * 1000));
    expect(estimateProgress(0, 6)).toBe(1);
    expect(estimateProgress(10 * 60_000, 6)).toBe(95);
  });
});

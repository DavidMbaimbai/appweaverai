import { describe, expect, it } from 'vitest';

import {
  composeReleaseText,
  getCapability,
  validateReleaseText,
  validateVideoForPlatform,
  type VideoFacts,
} from './capabilities';
import { parseVariants } from './localize';
import { MIN_HISTORY_SAMPLES, recommendTimes, upcomingSlots } from './recommend';
import { blockingPredecessor, generateSeries, sequenceOrderError } from './series';
import { buildSrt } from './subtitles';
import {
  MAX_ATTEMPTS,
  afterFailure,
  canTransition,
  claimForPublish,
  pendingLimit,
  planDue,
  releaseIdempotencyKey,
  type Dueable,
} from './status';

const NOW = new Date('2026-10-20T10:00:00Z');

describe('series generator', () => {
  it('builds Mon/Wed/Fri 18:00 local slots in order', () => {
    const result = generateSeries({
      pattern: { type: 'weekly', weekdays: [1, 3, 5], time: '18:00' },
      timeZone: 'Africa/Johannesburg',
      startDate: '2026-11-02',
      count: 4,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      '2026-11-02T16:00:00.000Z',
      '2026-11-04T16:00:00.000Z',
      '2026-11-06T16:00:00.000Z',
      '2026-11-09T16:00:00.000Z',
    ]);
    expect(result.slots.map((s) => s.episode)).toEqual([1, 2, 3, 4]);
  });

  it('keeps the local wall time across a DST change', () => {
    const result = generateSeries({
      pattern: { type: 'interval', everyDays: 3, time: '18:00' },
      timeZone: 'America/New_York',
      startDate: '2026-10-30',
      count: 2,
      now: NOW,
    });
    expect(result.ok && result.slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      '2026-10-30T22:00:00.000Z',
      '2026-11-02T23:00:00.000Z',
    ]);
  });

  it('supports daily and explicit dates, sorted and distinct', () => {
    const daily = generateSeries({ pattern: { type: 'daily', time: '09:30' }, timeZone: 'UTC', startDate: '2026-12-30', count: 3, now: NOW });
    expect(daily.ok && daily.slots.map((s) => s.localTime)).toEqual(['2026-12-30T09:30', '2026-12-31T09:30', '2027-01-01T09:30']);
    const explicit = generateSeries({
      pattern: { type: 'explicit', localTimes: ['2026-11-05T10:00', '2026-11-03T10:00'] },
      timeZone: 'UTC',
      startDate: '',
      count: 2,
      now: NOW,
    });
    expect(explicit.ok && explicit.slots.map((s) => s.episode)).toEqual([1, 2]);
    expect(explicit.ok && explicit.slots[0].localTime).toBe('2026-11-03T10:00');
    expect(
      generateSeries({ pattern: { type: 'explicit', localTimes: ['2026-11-03T10:00', '2026-11-03T10:00'] }, timeZone: 'UTC', startDate: '', count: 2, now: NOW }).ok,
    ).toBe(false);
  });

  it('rejects past starts, bad zones, bad input and empty weekdays', () => {
    const base = { timeZone: 'UTC', startDate: '2026-10-01', count: 2, now: NOW };
    expect(generateSeries({ ...base, pattern: { type: 'daily', time: '10:00' } }).ok).toBe(false);
    expect(generateSeries({ ...base, startDate: '2026-11-01', timeZone: 'Nope/Zone', pattern: { type: 'daily', time: '10:00' } }).ok).toBe(false);
    expect(generateSeries({ ...base, startDate: '2026-11-01', pattern: { type: 'daily', time: '25:00' } }).ok).toBe(false);
    expect(generateSeries({ ...base, startDate: '2026-11-01', pattern: { type: 'weekly', weekdays: [], time: '10:00' } }).ok).toBe(false);
    expect(generateSeries({ ...base, startDate: '2026-11-01', count: 0, pattern: { type: 'daily', time: '10:00' } }).ok).toBe(false);
  });
});

type R = Dueable & { id: string; attempts: number };
const release = (id: string, episode: number, status: string, hoursAgo = 1, extra: Partial<R> = {}): R => ({
  id,
  status,
  seriesKey: 'S',
  platform: 'YOUTUBE',
  language: 'en',
  season: 1,
  episode,
  attempts: 0,
  scheduledAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  nextAttemptAt: null,
  approvedAt: status === 'APPROVED' ? NOW : null,
  ...extra,
});

describe('sequence order', () => {
  it('episode n + 1 never publishes before n', () => {
    const ep1 = release('a', 1, 'APPROVED', 3);
    const ep2 = release('b', 2, 'APPROVED', 2);
    const plan = planDue([ep1, ep2], [ep1, ep2], NOW);
    expect(plan.due.map((r) => r.id)).toEqual(['a']);
    expect(plan.blocked[0].waitingFor.id).toBe('a');
  });

  it('a failed or paused predecessor blocks; published or cancelled does not', () => {
    const ep2 = release('b', 2, 'APPROVED');
    for (const status of ['FAILED', 'PAUSED', 'MANUAL', 'SCHEDULED']) {
      expect(blockingPredecessor(ep2, [release('a', 1, status), ep2])).not.toBeNull();
    }
    for (const status of ['PUBLISHED', 'CANCELLED']) {
      expect(blockingPredecessor(ep2, [release('a', 1, status), ep2])).toBeNull();
    }
    expect(blockingPredecessor(ep2, [release('a', 1, 'FAILED', 1, { language: 'fr' }), ep2])).toBeNull();
  });

  it('rejects reschedules that swap episode order', () => {
    const ep1 = release('a', 1, 'SCHEDULED', -24);
    const ep2 = release('b', 2, 'SCHEDULED', -48);
    expect(sequenceOrderError(ep2, new Date(NOW.getTime() + 12 * 3_600_000), [ep1, ep2])).toMatch(/Episode 1/);
    expect(sequenceOrderError(ep2, new Date(NOW.getTime() + 72 * 3_600_000), [ep1, ep2])).toBeNull();
  });
});

describe('capability validation', () => {
  const ok: VideoFacts = { jobStatus: 'SUCCEEDED', hasOutput: true, seconds: 6, aspect: '16:9', sizeBytes: 5_000_000 };

  it('blocks unfinished videos', () => {
    expect(validateVideoForPlatform('YOUTUBE', { ...ok, jobStatus: 'RUNNING' })).toEqual(['The video has not finished generating.']);
  });

  it('checks duration, size and aspect per platform', () => {
    expect(validateVideoForPlatform('YOUTUBE', ok)).toEqual([]);
    expect(validateVideoForPlatform('INSTAGRAM', ok)[0]).toMatch(/9:16/);
    expect(validateVideoForPlatform('INSTAGRAM', { ...ok, aspect: '9:16', seconds: 2 })[0]).toMatch(/at least 3s/);
    expect(validateVideoForPlatform('X', { ...ok, seconds: 200 })[0]).toMatch(/at most 140s/);
    expect(validateVideoForPlatform('LINKEDIN', { ...ok, sizeBytes: 300 * 1024 * 1024 })[0]).toMatch(/200 MB/);
    expect(validateVideoForPlatform('TIKTOK', { ...ok, sizeBytes: null })[0]).toMatch(/size could not be verified/);
  });

  it('validates text limits including hashtags', () => {
    expect(validateReleaseText('X', 'Hi', 'a'.repeat(275), ['tag'])[0]).toMatch(/280/);
    expect(validateReleaseText('YOUTUBE', '', '', [])[0]).toMatch(/title/);
    expect(composeReleaseText('X', 'Title', '', ['a', 'b'])).toBe('Title\n\n#a #b');
  });

  it('states automatic vs manual honestly from configuration', () => {
    expect(getCapability('YOUTUBE', {}).mode).toBe('manual');
    expect(getCapability('YOUTUBE', { GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }).mode).toBe('automatic');
    expect(getCapability('X', { X_CLIENT_ID: 'a' }).mode).toBe('manual');
    const tiktok = getCapability('TIKTOK', { TIKTOK_CLIENT_KEY: 'a', TIKTOK_CLIENT_SECRET: 'b' });
    expect(tiktok.mode).toBe('automatic');
    expect(tiktok.privateOnly).toBe(true);
    expect(tiktok.note).toMatch(/PRIVATE/);
    expect(getCapability('TIKTOK', { TIKTOK_CLIENT_KEY: 'a', TIKTOK_CLIENT_SECRET: 'b', TIKTOK_APP_AUDITED: 'true' }).privateOnly).toBe(false);
  });
});

describe('status transitions and idempotency', () => {
  it('only allows documented transitions', () => {
    expect(canTransition('SCHEDULED', 'APPROVED')).toBe(true);
    expect(canTransition('SCHEDULED', 'PUBLISHING')).toBe(false);
    expect(canTransition('APPROVED', 'PUBLISHING')).toBe(true);
    expect(canTransition('PUBLISHED', 'APPROVED')).toBe(false);
    expect(canTransition('CANCELLED', 'SCHEDULED')).toBe(false);
    expect(canTransition('PUBLISHING', 'PUBLISHED')).toBe(true);
  });

  it('only approved, due releases are ever selected; unapproved overdue ones go stale', () => {
    const unapproved = release('u', 1, 'SCHEDULED', 1);
    const approved = release('p', 1, 'APPROVED', 1, { seriesKey: null });
    const future = release('f', 1, 'APPROVED', -2, { seriesKey: null });
    const backoff = release('w', 1, 'APPROVED', 1, { seriesKey: null, nextAttemptAt: new Date(NOW.getTime() + 60_000) });
    const old = release('o', 1, 'SCHEDULED', 60, { seriesKey: null });
    const plan = planDue([unapproved, approved, future, backoff, old], [], NOW);
    expect(plan.due.map((r) => r.id)).toEqual(['p']);
    expect(plan.stale.map((r) => r.id)).toEqual(['o']);
  });

  it('retries with backoff up to three attempts, then fails', () => {
    const first = afterFailure(1, true, NOW);
    expect(first.status).toBe('APPROVED');
    expect(first.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(afterFailure(2, true, NOW).nextAttemptAt?.getTime()).toBe(NOW.getTime() + 15 * 60_000);
    expect(afterFailure(MAX_ATTEMPTS, true, NOW).status).toBe('FAILED');
    expect(afterFailure(1, false, NOW).status).toBe('FAILED');
  });

  it('claims a row for only one runner', async () => {
    let status = 'APPROVED';
    let attempts = 0;
    const delegate = {
      async updateMany(args: { where: { status: string; attempts: number }; data: { attempts: { increment: number } } }) {
        if (status !== args.where.status || attempts !== args.where.attempts) return { count: 0 };
        status = 'PUBLISHING';
        attempts += args.data.attempts.increment;
        return { count: 1 };
      },
    };
    const results = await Promise.all([
      claimForPublish(delegate as never, 'x', 0),
      claimForPublish(delegate as never, 'x', 0),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(attempts).toBe(1);
  });

  it('derives a stable idempotency key per slot', () => {
    const input = { userId: 'u', jobId: 'j', platform: 'YOUTUBE', language: 'en', scheduledAt: NOW };
    expect(releaseIdempotencyKey(input)).toBe(releaseIdempotencyKey({ ...input }));
    expect(releaseIdempotencyKey(input)).not.toBe(releaseIdempotencyKey({ ...input, language: 'fr' }));
  });

  it('applies the plan limits', () => {
    expect(pendingLimit('free')).toBe(5);
    expect(pendingLimit(null)).toBe(5);
    expect(pendingLimit('pro')).toBe(200);
  });
});

describe('recommendations', () => {
  it('falls back to clearly labelled general windows without measured history', () => {
    const rec = recommendTimes('YOUTUBE', [], 'UTC');
    expect(rec.basis).toBe('general');
    expect(rec.basisLabel).toMatch(/not based on your data/);
    expect(rec.windows.length).toBeGreaterThan(0);
    const unmeasured = Array.from({ length: 10 }, (_, i) => ({ platform: 'YOUTUBE', publishedAt: new Date(NOW.getTime() + i * 86_400_000), views: null }));
    expect(recommendTimes('YOUTUBE', unmeasured, 'UTC').basis).toBe('general');
  });

  it('uses only own measured history once there is enough of it', () => {
    const at = (day: number, hour: number, views: number) => ({
      platform: 'YOUTUBE',
      publishedAt: new Date(Date.UTC(2026, 9, day, hour)),
      views,
    });
    const history = [at(5, 9, 100), at(12, 9, 140), at(6, 18, 900), at(13, 18, 700), at(7, 12, 50)];
    expect(history.length).toBeGreaterThanOrEqual(MIN_HISTORY_SAMPLES);
    const rec = recommendTimes('YOUTUBE', history, 'UTC');
    expect(rec.basis).toBe('own-history');
    expect(rec.windows[0]).toMatchObject({ weekday: 2, hour: 18, averageViews: 800, samples: 2 });
    expect(recommendTimes('TIKTOK', history, 'UTC').basis).toBe('general');
  });

  it('turns windows into future instants', () => {
    const slots = upcomingSlots([{ weekday: 4, hour: 17, label: 'Thursday 17:00' }], 'UTC', NOW, 2);
    expect(slots.map((d) => d.toISOString())).toEqual(['2026-10-22T17:00:00.000Z', '2026-10-29T17:00:00.000Z']);
  });
});

describe('subtitles and localization parsing', () => {
  it('states unavailable instead of inventing text', () => {
    const result = buildSrt([{ prompt: '  ', seconds: 6 }]);
    expect(result.available).toBe(false);
  });

  it('builds cues only for scenes with text, with running time', () => {
    const result = buildSrt([
      { prompt: 'A red door opens', seconds: 6 },
      { prompt: '', seconds: 4 },
      { prompt: 'Sunrise over hills', seconds: 6 },
    ]);
    expect(result.available && result.srt).toBe(
      '1\n00:00:00,000 --> 00:00:06,000\nA red door opens\n\n2\n00:00:10,000 --> 00:00:16,000\nSunrise over hills\n',
    );
  });

  it('keeps only requested, complete variants', () => {
    const raw = JSON.stringify({
      variants: [
        { language: 'fr', title: 'Bonjour', caption: 'Salut', hashtags: ['#a', 'b'] },
        { language: 'de', title: 'Hallo', caption: '', hashtags: [] },
        { language: 'es', title: '', caption: 'x', hashtags: [] },
      ],
    });
    const parsed = parseVariants(`here: ${raw}`, ['fr', 'es']);
    expect(parsed).toEqual([{ language: 'fr', title: 'Bonjour', caption: 'Salut', hashtags: ['a', 'b'] }]);
  });
});

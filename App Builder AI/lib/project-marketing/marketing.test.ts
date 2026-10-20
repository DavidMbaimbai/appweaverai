import { describe, expect, it } from 'vitest';

import { onlyOwnLinks } from './generate';
import {
  approvedStatus,
  campaignStatus,
  composePostText,
  groupByDate,
  normalizeHashtags,
  parseCampaign,
  resolveSchedule,
  selectDuePosts,
  suggestedSlot,
  validatePostText,
} from './logic';
import { createState, safeReturnTo, verifyState } from './oauth';
import { escapeLinkedIn } from './publish';

const NOW = new Date('2026-11-02T12:00:00Z');
const hour = 3_600_000;

describe('selectDuePosts', () => {
  const post = (id: string, status: string, offsetH: number | null) => ({
    id,
    status,
    scheduledAt: offsetH === null ? null : new Date(NOW.getTime() + offsetH * hour),
  });

  it('only returns approved posts that are due, oldest first', () => {
    const { due, stale } = selectDuePosts(
      [
        post('draft', 'DRAFT', -1),
        post('future', 'SCHEDULED', 1),
        post('b', 'SCHEDULED', -1),
        post('a', 'APPROVED', -2),
        post('manual', 'MANUAL', -1),
        post('none', 'APPROVED', null),
        post('old', 'SCHEDULED', -72),
      ],
      NOW,
    );
    expect(due.map((p) => p.id)).toEqual(['a', 'b']);
    expect(stale.map((p) => p.id)).toEqual(['old']);
  });
});

describe('scheduling', () => {
  it('converts a wall-clock time in any zone to UTC', () => {
    const r = resolveSchedule('2026-11-05T09:30', 'America/New_York', NOW);
    expect(r.ok && r.at.toISOString()).toBe('2026-11-05T14:30:00.000Z');
  });

  it('rejects past, too-far and invalid input', () => {
    expect(resolveSchedule('2026-11-01T09:30', 'UTC', NOW).ok).toBe(false);
    expect(resolveSchedule('2027-03-01T09:30', 'UTC', NOW).ok).toBe(false);
    expect(resolveSchedule('nope', 'UTC', NOW).ok).toBe(false);
    expect(resolveSchedule('2026-11-05T09:30', 'Mars/Base', NOW).ok).toBe(false);
  });

  it('suggests a slot relative to the local day', () => {
    expect(suggestedSlot(NOW, 2, '10:00', 'Asia/Tokyo')?.toISOString()).toBe('2026-11-04T01:00:00.000Z');
  });

  it('marks unsupported or unconnected platforms for manual posting', () => {
    expect(approvedStatus('TIKTOK', true)).toBe('MANUAL');
    expect(approvedStatus('X', false)).toBe('MANUAL');
    expect(approvedStatus('X', true)).toBe('SCHEDULED');
  });

  it('groups by local date and derives campaign status', () => {
    const groups = groupByDate([
      { scheduledAt: new Date('2026-11-03T23:30:00Z'), timeZone: 'Asia/Tokyo' },
      { scheduledAt: null, timeZone: 'UTC' },
      { scheduledAt: new Date('2026-11-03T01:00:00Z'), timeZone: 'UTC' },
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-11-03', '2026-11-04', 'Unscheduled']);
    expect(campaignStatus(['PUBLISHED', 'MANUAL'])).toBe('PUBLISHED');
    expect(campaignStatus(['PUBLISHED', 'SCHEDULED'])).toBe('SCHEDULED');
    expect(campaignStatus(['DRAFT', 'FAILED'])).toBe('DRAFT');
  });
});

describe('parseCampaign', () => {
  const json = (posts: unknown[]) => `Here you go:\n${JSON.stringify({ name: 'Launch', posts })}`;

  it('keeps valid posts and drops invalid ones', () => {
    const parsed = parseCampaign(
      json([
        { platform: 'x', text: 'Our new app is live.', hashtags: ['#launch', 'New App!'], dayOffset: 2, time: '09:15' },
        { platform: 'X', text: 'y'.repeat(300), hashtags: [], dayOffset: 1, time: '10:00' },
        { platform: 'MYSPACE', text: 'hi', hashtags: [] },
        { platform: 'LINKEDIN', text: 'Guaranteed to double your income', hashtags: [] },
      ]),
    );
    expect(parsed?.posts).toHaveLength(1);
    expect(parsed?.posts[0]).toMatchObject({ platform: 'X', hashtags: ['launch', 'NewApp'], dayOffset: 2, time: '09:15' });
  });

  it('returns null for garbage', () => {
    expect(parseCampaign('no json')).toBeNull();
    expect(parseCampaign(json([]))).toBeNull();
  });
});

describe('text helpers', () => {
  it('normalizes hashtags and composes text', () => {
    expect(normalizeHashtags('#a, b  #a')).toEqual(['a', 'b']);
    expect(composePostText(' Hi ', ['a', 'b'])).toBe('Hi\n\n#a #b');
    expect(validatePostText('X', 'x'.repeat(275), ['tag'])).toMatch(/280/);
  });

  it('drops posts with links to other sites', () => {
    const posts = [{ text: 'See https://my.app/x' }, { text: 'See https://evil.com' }, { text: 'No link' }];
    expect(onlyOwnLinks(posts, 'https://my.app').map((p) => p.text)).toEqual(['See https://my.app/x', 'No link']);
    expect(onlyOwnLinks(posts, null).map((p) => p.text)).toEqual(['No link']);
  });

  it('escapes LinkedIn markup characters', () => {
    expect(escapeLinkedIn('a_b (c)')).toBe('a\\_b \\(c\\)');
  });
});

describe('oauth state', () => {
  it('round-trips, expires and rejects tampering', () => {
    process.env.LINKEDIN_CLIENT_ID = 'id';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    const state = createState('LINKEDIN', { userId: 'u1', returnTo: 'ws/proj' }, 1000);
    expect(verifyState('LINKEDIN', state, 2000)).toEqual({ userId: 'u1', returnTo: 'ws/proj' });
    expect(verifyState('LINKEDIN', state, 1000 + 11 * 60_000)).toBeNull();
    expect(verifyState('LINKEDIN', `${state}x`, 2000)).toBeNull();
    expect(verifyState('FACEBOOK', state, 2000)).toBeNull();
    expect(safeReturnTo('ws/proj')).toBe('ws/proj');
    expect(safeReturnTo('//evil.com')).toBeNull();
  });
});

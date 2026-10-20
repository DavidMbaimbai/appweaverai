import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/agents', () => ({ runAgentAction: vi.fn(), registerAgentExecutor: vi.fn() }));

import { autoBookGate, isSensitiveCommitment, parseActionItems } from './ai';
import {
  bucketsFor,
  canTransition,
  commonFree,
  formatInZone,
  idempotencyKeyFor,
  parseParticipants,
  renderInvite,
  signMeetingToken,
  verifyMeetingToken,
} from './logic';

const at = (iso: string) => new Date(iso);

describe('multi-participant availability', () => {
  it('intersects free time using only busy intervals', () => {
    const window = { start: at('2026-03-02T09:00:00Z'), end: at('2026-03-02T17:00:00Z') };
    const free = commonFree(window, [
      [{ start: at('2026-03-02T10:00:00Z'), end: at('2026-03-02T11:00:00Z') }],
      [{ start: at('2026-03-02T10:30:00Z'), end: at('2026-03-02T12:00:00Z') }],
    ]);
    expect(free).toEqual([
      { start: at('2026-03-02T09:00:00Z'), end: at('2026-03-02T10:00:00Z') },
      { start: at('2026-03-02T12:00:00Z'), end: at('2026-03-02T17:00:00Z') },
    ]);
  });

  it('returns nothing when the window is fully busy', () => {
    const window = { start: at('2026-03-02T09:00:00Z'), end: at('2026-03-02T10:00:00Z') };
    expect(commonFree(window, [[{ start: at('2026-03-02T08:00:00Z'), end: at('2026-03-02T11:00:00Z') }]])).toEqual([]);
  });
});

describe('time zones and DST', () => {
  it('renders the same instant in each participant zone, DST-aware', () => {
    // US DST began 2026-03-08: 14:00Z is 09:00 EST before and 10:00 EDT after.
    expect(formatInZone(at('2026-03-07T14:00:00Z'), 'America/New_York')).toContain('9:00');
    expect(formatInZone(at('2026-03-09T14:00:00Z'), 'America/New_York')).toContain('10:00');
  });

  it('drops invalid time zones from participants', () => {
    const [p] = parseParticipants([{ name: 'A', email: 'A@Example.com', timeZone: 'Not/AZone' }]);
    expect(p.timeZone).toBeNull();
    expect(p.email).toBe('a@example.com');
  });
});

describe('signed links', () => {
  beforeEach(() => vi.stubEnv('MEETING_LINK_SECRET', 'test-secret'));
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips and binds the participant email', () => {
    const token = signMeetingToken('m1', 2, 'Ann@Example.com', at('2099-01-01T00:00:00Z'));
    expect(verifyMeetingToken(token)).toMatchObject({ m: 'm1', v: 2, e: 'ann@example.com' });
  });

  it('rejects tampered and expired tokens', () => {
    const token = signMeetingToken('m1', 1, 'a@b.co', at('2099-01-01T00:00:00Z'));
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ m: 'other', v: 1, e: 'a@b.co', exp: 4e12 })).toString('base64url');
    expect(verifyMeetingToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyMeetingToken(`${body}.x${mac}`)).toBeNull();
    expect(verifyMeetingToken(signMeetingToken('m1', 1, 'a@b.co', at('2020-01-01T00:00:00Z')))).toBeNull();
  });
});

describe('duplicate prevention', () => {
  it('derives a stable idempotency key per source and slot', () => {
    expect(idempotencyKeyFor(['INVESTOR', 'c1', 1])).toBe(idempotencyKeyFor(['INVESTOR', 'c1', 1]));
    expect(idempotencyKeyFor(['INVESTOR', 'c1', 1])).not.toBe(idempotencyKeyFor(['INVESTOR', 'c1', 2]));
  });

  it('does not allow leaving terminal states', () => {
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransition('COMPLETED', 'CONFIRMED')).toBe(false);
    expect(canTransition('AWAITING_CONFIRMATION', 'CONFIRMED')).toBe(true);
  });
});

describe('invitations', () => {
  it('includes time zone, duration, agenda and manage link but no emails', () => {
    const view = {
      title: 'Intro call',
      startsAt: at('2026-03-09T14:00:00Z'),
      timeZone: 'America/New_York',
      durationMin: 30,
      participants: [{ name: 'Ann', email: 'ann@example.com' }],
      agenda: 'Discuss the round',
      conferenceUrl: 'https://meet.example.com/x',
      location: null,
      manageUrl: 'https://app.example.com/meeting/tok',
    } as unknown as Parameters<typeof renderInvite>[0];
    const out = renderInvite(view, 'Confirmed');
    expect(out.text).toContain('Discuss the round');
    expect(out.text).toContain('30');
    expect(out.text).toContain('https://app.example.com/meeting/tok');
    expect(out.text).not.toContain('ann@example.com');
  });
});

describe('AI scheduling gates', () => {
  it('books autonomously only for authorised types after the participant agreed', () => {
    expect(autoBookGate({ autonomousBooking: true, requiresApproval: false }, false).allowed).toBe(false);
    expect(autoBookGate({ autonomousBooking: false, requiresApproval: false }, true).allowed).toBe(false);
    expect(autoBookGate({ autonomousBooking: true, requiresApproval: false }, true).allowed).toBe(true);
  });

  it('flags sensitive commitments for approval', () => {
    expect(isSensitiveCommitment('Offer a 20% discount')).toBe(true);
    const items = parseActionItems('- Send the deck\n- Agree equity terms');
    expect(items.map((i) => i.sensitive)).toEqual([false, true]);
    expect(items.every((i) => !i.approved)).toBe(true);
  });
});

describe('admin buckets', () => {
  const now = at('2026-03-02T12:00:00Z');
  it('places meetings by status and category', () => {
    expect(bucketsFor({ status: 'CONFIRMED', category: 'INVESTOR', startsAt: at('2026-03-02T15:00:00Z') }, now)).toEqual(['today', 'upcoming', 'investor']);
    expect(bucketsFor({ status: 'REQUESTED', category: 'USER', startsAt: null }, now)).toEqual(['pending', 'customer']);
    expect(bucketsFor({ status: 'CANCELLED', category: 'USER', startsAt: null }, now)).toEqual(['closed']);
    expect(bucketsFor({ status: 'COMPLETED', category: 'USER', startsAt: null, nextSteps: [{ text: 'x' }] }, now)).toEqual(['closed', 'followUps']);
  });
});

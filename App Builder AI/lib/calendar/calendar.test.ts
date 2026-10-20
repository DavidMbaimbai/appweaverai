import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calendarConnection: { findUnique: vi.fn(), update: vi.fn() },
  leadAvailabilitySlot: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));

import { encryptSecret } from '@/lib/crypto/secret-box';

import { checkSlotFree } from './bookings';
import { eventIdFor, generateSlots, isStartBookable, parseWorkingHours, workingWindows, type SlotRules } from './logic';
import { CalendarAuthError, createEvent, fetchBusy, refreshAccessToken } from './providers';
import { withCalendar } from './service';

const fetchMock = vi.fn();
const respond = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BETTER_AUTH_SECRET = 'test-secret';
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'gid';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'gsecret';
  process.env.MICROSOFT_CALENDAR_CLIENT_ID = 'mid';
  process.env.MICROSOFT_CALENDAR_CLIENT_SECRET = 'msecret';
});
afterEach(() => vi.unstubAllGlobals());

const hours = parseWorkingHours({ mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], fri: [['09:00', '17:00']] })!;
const base = (over: Partial<SlotRules> = {}): SlotRules => ({
  now: new Date('2026-11-01T00:00:00Z'),
  days: 7,
  timeZone: 'UTC',
  workingHours: hours,
  durationMin: 30,
  stepMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMin: 0,
  busy: [],
  ...over,
});

describe('availability math', () => {
  it('only offers working hours and removes busy time with buffers', () => {
    const monday = '2026-11-02';
    const busy = [{ start: new Date(`${monday}T10:00:00Z`), end: new Date(`${monday}T11:00:00Z`) }];
    const slots = generateSlots(base({ busy, bufferBeforeMin: 15, bufferAfterMin: 15 })).map((d) => d.toISOString());
    expect(slots).toContain(`${monday}T09:00:00.000Z`);
    expect(slots).not.toContain(`${monday}T09:30:00.000Z`); // 30 min slot + 15 min buffer touches 10:00
    expect(slots).not.toContain(`${monday}T10:30:00.000Z`);
    expect(slots).not.toContain(`${monday}T11:00:00.000Z`); // buffer after the meeting ends at 11:15
    expect(slots).toContain(`${monday}T11:30:00.000Z`);
    expect(slots.some((s) => s.startsWith('2026-11-03T08'))).toBe(false);
    expect(slots.some((s) => s.startsWith('2026-11-04'))).toBe(false); // Wednesday is not a working day
  });

  it('respects minimum notice', () => {
    const rules = base({ now: new Date('2026-11-02T08:00:00Z'), minNoticeMin: 180 });
    const first = generateSlots(rules)[0];
    expect(first.toISOString()).toBe('2026-11-02T11:00:00.000Z');
    expect(isStartBookable(new Date('2026-11-02T10:00:00Z'), rules)).toBe(false);
  });

  it('rejects malformed working hours', () => {
    expect(parseWorkingHours({ mon: [['17:00', '09:00']] })).toBeNull();
    expect(parseWorkingHours({ xyz: [['09:00', '10:00']] })).toBeNull();
  });
});

describe('time zones and DST', () => {
  it('keeps 09:00 local across the US spring-forward change', () => {
    const rules = { now: new Date('2026-03-05T00:00:00Z'), days: 6, timeZone: 'America/New_York', workingHours: parseWorkingHours({ fri: [['09:00', '17:00']], mon: [['09:00', '17:00']] })! };
    const starts = workingWindows(rules).map((w) => w.start.toISOString());
    expect(starts).toEqual(['2026-03-06T14:00:00.000Z', '2026-03-09T13:00:00.000Z']); // EST then EDT
  });

  it('computes the real length of the Berlin fall-back day', () => {
    const rules = { now: new Date('2026-10-24T00:00:00Z'), days: 2, timeZone: 'Europe/Berlin', workingHours: parseWorkingHours({ sun: [['00:00', '06:00']] })! };
    const [w] = workingWindows(rules);
    expect((w.end.getTime() - w.start.getTime()) / 3600_000).toBe(7); // 25-hour day: 00:00-06:00 spans 7 real hours
  });
});

describe('idempotent event ids', () => {
  it('is deterministic and valid for Google', () => {
    expect(eventIdFor('lead-booking:b1')).toBe(eventIdFor('lead-booking:b1'));
    expect(eventIdFor('lead-booking:b1')).not.toBe(eventIdFor('lead-booking:b2'));
    expect(eventIdFor('x')).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it('returns the existing Google event on a retry instead of duplicating', async () => {
    const existing = { id: 'abid', status: 'confirmed', start: { dateTime: '2026-11-02T10:00:00Z' }, end: { dateTime: '2026-11-02T10:30:00Z' } };
    fetchMock.mockResolvedValueOnce(respond({ error: { code: 409 } }, 409)).mockResolvedValueOnce(respond(existing));
    const out = await createEvent('GOOGLE', 'tok', {
      eventId: 'abid',
      title: 't',
      description: 'd',
      start: new Date('2026-11-02T10:00:00Z'),
      end: new Date('2026-11-02T10:30:00Z'),
    });
    expect(out.eventId).toBe('abid');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/events/abid');
  });

  it('sends the Graph transactionId', async () => {
    fetchMock.mockResolvedValueOnce(respond({ id: 'graph-1', start: { dateTime: '2026-11-02T10:00:00.0000000' }, end: { dateTime: '2026-11-02T10:30:00.0000000' } }));
    await createEvent('MICROSOFT', 'tok', { eventId: 'abid', title: 't', description: 'd', start: new Date('2026-11-02T10:00:00Z'), end: new Date('2026-11-02T10:30:00Z') });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).transactionId).toBe('abid');
  });
});

describe('free/busy', () => {
  it('reads Google busy intervals only', async () => {
    fetchMock.mockResolvedValueOnce(respond({ calendars: { primary: { busy: [{ start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z' }] } } }));
    const busy = await fetchBusy('GOOGLE', 'tok', { start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') });
    expect(busy).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('q');
  });

  it('ignores free and cancelled Graph events', async () => {
    fetchMock.mockResolvedValueOnce(
      respond({
        value: [
          { start: { dateTime: '2026-11-02T10:00:00.0000000' }, end: { dateTime: '2026-11-02T11:00:00.0000000' }, showAs: 'busy' },
          { start: { dateTime: '2026-11-02T12:00:00.0000000' }, end: { dateTime: '2026-11-02T13:00:00.0000000' }, showAs: 'free' },
          { start: { dateTime: '2026-11-02T14:00:00.0000000' }, end: { dateTime: '2026-11-02T15:00:00.0000000' }, showAs: 'busy', isCancelled: true },
        ],
      }),
    );
    const busy = await fetchBusy('MICROSOFT', 'tok', { start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') });
    expect(busy.map((b) => b.start.toISOString())).toEqual(['2026-11-02T10:00:00.000Z']);
  });
});

const connRow = (over = {}) => ({
  id: 'c1',
  scopeKey: 'p1',
  provider: 'GOOGLE',
  status: 'CONNECTED',
  refreshTokenEnc: encryptSecret('refresh'),
  accessTokenEnc: null,
  accessTokenExpiresAt: null,
  verifiedAt: new Date(),
  calendarId: 'primary',
  timeZone: 'UTC',
  workingHours: { mon: [['09:00', '17:00']] },
  durationMin: 30,
  slotStepMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMin: 0,
  ...over,
});

describe('revoked tokens', () => {
  it('marks the connection NEEDS_RECONNECT and surfaces the error', async () => {
    fetchMock.mockImplementation(async () => respond({ error: 'invalid_grant' }, 400));
    await expect(withCalendar(connRow() as never, async () => 'x')).rejects.toBeInstanceOf(CalendarAuthError);
    expect(db.calendarConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'NEEDS_RECONNECT', refreshTokenEnc: null, verifiedAt: null }) }));
  });

  it('refreshes once after a 401 and then succeeds', async () => {
    fetchMock.mockImplementation(async () => respond({ access_token: 'new', expires_in: 3600 }));
    const calls: string[] = [];
    const out = await withCalendar(connRow() as never, async (token) => {
      calls.push(token);
      if (calls.length === 1) throw new CalendarAuthError('401');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toEqual(['new', 'new']);
  });

  it('rejects a refresh that the provider revoked', async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: 'invalid_grant' }, 400));
    await expect(refreshAccessToken('MICROSOFT', 'r')).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe('conflict re-check', () => {
  const tx = { leadAvailabilitySlot: { findMany: vi.fn().mockResolvedValue([]) } } as never;
  const now = new Date('2026-11-01T00:00:00Z');

  it('returns TAKEN when the calendar became busy', async () => {
    db.calendarConnection.update.mockResolvedValue({});
    fetchMock.mockResolvedValueOnce(respond({ access_token: 'a', expires_in: 3600 })).mockResolvedValueOnce(
      respond({ calendars: { primary: { busy: [{ start: '2026-11-02T10:00:00Z', end: '2026-11-02T10:30:00Z' }] } } }),
    );
    expect(await checkSlotFree(tx, connRow() as never, 'p1', new Date('2026-11-02T10:00:00Z'), 30, { enforceHours: true, now })).toBe('TAKEN');
  });

  it('returns OK when free, and UNVERIFIABLE when the lookup fails (never guesses)', async () => {
    fetchMock.mockResolvedValueOnce(respond({ access_token: 'a', expires_in: 3600 })).mockResolvedValueOnce(respond({ calendars: { primary: { busy: [] } } }));
    expect(await checkSlotFree(tx, connRow() as never, 'p1', new Date('2026-11-02T10:00:00Z'), 30, { enforceHours: true, now })).toBe('OK');
    fetchMock.mockResolvedValueOnce(respond({ access_token: 'a', expires_in: 3600 })).mockResolvedValueOnce(respond({ error: 'boom' }, 500));
    expect(await checkSlotFree(tx, connRow() as never, 'p1', new Date('2026-11-02T10:00:00Z'), 30, { enforceHours: true, now })).toBe('UNVERIFIABLE');
  });

  it('treats our own stored bookings as busy', async () => {
    const own = { leadAvailabilitySlot: { findMany: vi.fn().mockResolvedValue([{ startsAt: new Date('2026-11-02T10:00:00Z'), durationMin: 30 }]) } } as never;
    fetchMock.mockResolvedValueOnce(respond({ access_token: 'a', expires_in: 3600 })).mockResolvedValueOnce(respond({ calendars: { primary: { busy: [] } } }));
    expect(await checkSlotFree(own, connRow() as never, 'p1', new Date('2026-11-02T10:00:00Z'), 30, { enforceHours: true, now })).toBe('TAKEN');
  });
});

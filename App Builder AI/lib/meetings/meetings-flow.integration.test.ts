import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma } from '@/tests/integration/db';

const sendEmail = vi.hoisted(() => vi.fn(async (_message: unknown) => undefined));
vi.mock('@/lib/email', () => ({ sendEmail }));
vi.mock('@/lib/crypto/secret-box', () => ({ encryptSecret: (v: string) => `enc:${v}`, decryptSecret: (v: string) => v.replace(/^enc:/, '') }));

const calendar = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  fetchBusy: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  getEvent: vi.fn(),
}));
vi.mock('@/lib/calendar/providers', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/calendar/providers')>()), ...calendar }));

import { CalendarAuthError } from '@/lib/calendar/providers';
import { confirmMeeting, createMeetingRequest, platformScope, projectScope, type Scope } from './service';
import { processDueReminders, processReminder } from './notify';

function futureSlot(hour = 10, days = 14) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  while ([0, 5, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

async function request(label: string, extra: { scope?: Scope; sourceType?: 'MANUAL' | 'INVESTOR'; sourceId?: string; category?: 'CUSTOMER' | 'INVESTOR' } = {}) {
  const { meeting } = await createMeetingRequest({
    scope: extra.scope ?? platformScope,
    category: extra.category ?? 'CUSTOMER',
    title: `Call ${label}`,
    participants: [{ name: label, email: `${label}@example.test`, timeZone: 'UTC' }],
    sourceType: extra.sourceType ?? 'MANUAL',
    sourceId: extra.sourceId ?? `src-${label}`,
    idempotencyKey: `flow-${label}`,
  });
  return meeting;
}

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  Object.values(calendar).forEach((fn) => fn.mockReset());
  vi.unstubAllEnvs();
});

describe('meeting notifications (real Postgres)', () => {
  it('retries a failed confirmation email with backoff, then sends it exactly once', async () => {
    const m = await request('mail');
    const slot = futureSlot();
    expect((await confirmMeeting(m.id, slot, 'tester')).ok).toBe(true);
    const row = await prisma.meetingReminder.findFirstOrThrow({ where: { meetingId: m.id, channel: 'EMAIL', offsetMin: { lt: 0 } } });

    sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    const now = new Date();
    expect(await processReminder(row.id, now)).toBe('RETRY');
    const retrying = await prisma.meetingReminder.findUniqueOrThrow({ where: { id: row.id } });
    expect(retrying.status).toBe('PENDING');
    expect(retrying.lastError).toContain('smtp down');
    expect(retrying.dueAt.getTime()).toBeGreaterThan(now.getTime());

    expect(await processReminder(row.id, new Date(now.getTime() + 5 * 60_000))).toBe('SENT');
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect((await prisma.meetingReminder.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');
    expect(await processReminder(row.id, new Date(now.getTime() + 10 * 60_000))).toBe('CLAIMED');
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('marks the reminder FAILED and alerts staff after the maximum attempts', async () => {
    const owner = await makeUser();
    const m = await request('dead');
    await prisma.meeting.update({ where: { id: m.id }, data: { hostUserId: owner.id } });
    await confirmMeeting(m.id, futureSlot(), 'tester');
    const row = await prisma.meetingReminder.findFirstOrThrow({ where: { meetingId: m.id, channel: 'EMAIL', offsetMin: { lt: 0 } } });
    sendEmail.mockRejectedValue(new Error('smtp down'));

    let at = Date.now();
    let last = '';
    for (let i = 0; i < 6 && last !== 'FAILED'; i++) {
      last = await processReminder(row.id, new Date(at));
      at += 60 * 60_000;
    }
    expect(last).toBe('FAILED');
    expect((await prisma.meetingReminder.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('FAILED');
    expect(await prisma.meetingNotification.count({ where: { userId: owner.id, title: { contains: 'Could not deliver' } } })).toBe(1);
  });

  it('does not double-send when two crons process the same due reminders concurrently', async () => {
    const m = await request('dupe');
    await confirmMeeting(m.id, futureSlot(), 'tester');
    const now = new Date(Date.now() + 60_000);
    const [a, b] = await Promise.all([processDueReminders(100, now), processDueReminders(100, now)]);
    expect(a.processed + b.processed).toBe(await prisma.meetingReminder.count({ where: { status: { not: 'PENDING' } } }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const again = await processDueReminders(100, now);
    expect(again.processed).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('keeps one reminder row per offset and channel when a meeting is re-confirmed', async () => {
    const m = await request('resched');
    const slot = futureSlot();
    await confirmMeeting(m.id, slot, 'tester');
    await confirmMeeting(m.id, slot, 'tester');
    const rows = await prisma.meetingReminder.groupBy({ by: ['offsetMin', 'channel'], where: { meetingId: m.id }, _count: true });
    expect(rows.every((r) => r._count === 1)).toBe(true);
    expect(await prisma.meetingReminder.count({ where: { meetingId: m.id, offsetMin: { lt: 0 } } })).toBe(1);
  });
});

describe('investor CRM on booking (real Postgres)', () => {
  it('moves the investor to MEETING_SCHEDULED, logs activity and closes the open meeting request', async () => {
    const owner = await makeUser();
    const { project } = await makeProjectFor(owner);
    const investor = await prisma.hubInvestor.create({ data: { userId: owner.id, projectId: project.id, name: 'Vera VC' } });
    await prisma.investorMeetingRequest.create({ data: { userId: owner.id, projectId: project.id, investorId: investor.id, note: 'intro' } });

    const m = await request('vc', { scope: projectScope(project.id), sourceType: 'INVESTOR', sourceId: investor.id, category: 'INVESTOR' });
    expect((await confirmMeeting(m.id, futureSlot(), 'tester')).ok).toBe(true);

    expect((await prisma.hubInvestor.findUniqueOrThrow({ where: { id: investor.id } })).pipelineStage).toBe('MEETING_SCHEDULED');
    expect(await prisma.hubInvestorActivity.count({ where: { investorId: investor.id, type: 'meeting_confirmed' } })).toBe(1);
    expect((await prisma.investorMeetingRequest.findFirstOrThrow({ where: { investorId: investor.id } })).status).toBe('DONE');
  });

  it('ignores an investor that belongs to a different project', async () => {
    const owner = await makeUser();
    const { project } = await makeProjectFor(owner);
    const other = await makeProjectFor(await makeUser());
    const investor = await prisma.hubInvestor.create({ data: { userId: owner.id, projectId: project.id, name: 'Wrong Scope' } });
    const m = await request('vc2', { scope: projectScope(other.project.id), sourceType: 'INVESTOR', sourceId: investor.id, category: 'INVESTOR' });
    expect((await confirmMeeting(m.id, futureSlot(), 'tester')).ok).toBe(true);
    expect((await prisma.hubInvestor.findUniqueOrThrow({ where: { id: investor.id } })).pipelineStage).toBe('DISCOVERED');
  });
});

describe('calendar disconnect and recovery (real Postgres)', () => {
  async function connectCalendar() {
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', 'secret');
    const owner = await makeUser();
    await prisma.calendarConnection.create({
      data: { scopeKey: 'PLATFORM', ownerId: owner.id, provider: 'GOOGLE', status: 'CONNECTED', refreshTokenEnc: 'enc:refresh', verifiedAt: new Date() },
    });
    calendar.refreshAccessToken.mockResolvedValue({ accessToken: 'tok', refreshToken: null, expiresAt: new Date(Date.now() + 3600_000), scopes: '' });
    calendar.fetchBusy.mockResolvedValue([]);
  }

  it('books nothing when the provider revokes access, then books once the calendar is reconnected', async () => {
    await connectCalendar();
    const m = await request('cal');
    const slot = futureSlot();
    calendar.createEvent.mockRejectedValue(new CalendarAuthError('invalid_grant'));

    const failed = await confirmMeeting(m.id, slot, 'tester');
    expect(!failed.ok && failed.code).toBe('EVENT_FAILED');
    expect(await prisma.meetingSlotLock.count()).toBe(0);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).status).not.toBe('CONFIRMED');
    const broken = await prisma.calendarConnection.findUniqueOrThrow({ where: { scopeKey: 'PLATFORM' } });
    expect(broken.status).toBe('NEEDS_RECONNECT');
    expect(broken.refreshTokenEnc).toBeNull();

    await prisma.calendarConnection.update({ where: { scopeKey: 'PLATFORM' }, data: { status: 'CONNECTED', refreshTokenEnc: 'enc:new', verifiedAt: new Date() } });
    calendar.createEvent.mockResolvedValue({ eventId: 'evt_1', conferenceUrl: null, start: slot, end: slot, cancelled: false });
    const ok = await confirmMeeting(m.id, slot, 'tester');
    expect(ok.ok).toBe(true);
    const booked = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(booked.status).toBe('CONFIRMED');
    expect(booked.externalEventId).toBe('evt_1');
    expect(await prisma.meetingSlotLock.count()).toBe(1);
  });

  it('refuses to book when free/busy cannot be read and leaves no slot held', async () => {
    await connectCalendar();
    const m = await request('busy');
    calendar.fetchBusy.mockRejectedValue(new Error('timeout'));
    const res = await confirmMeeting(m.id, futureSlot(), 'tester');
    expect(!res.ok && res.code).toBe('UNVERIFIABLE');
    expect(await prisma.meetingSlotLock.count()).toBe(0);
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });

  it('respects busy time on the connected calendar', async () => {
    await connectCalendar();
    const m = await request('clash');
    const slot = futureSlot();
    calendar.fetchBusy.mockResolvedValue([{ start: new Date(slot.getTime() - 15 * 60_000), end: new Date(slot.getTime() + 15 * 60_000) }]);
    const res = await confirmMeeting(m.id, slot, 'tester');
    expect(!res.ok && res.code).toBe('TAKEN');
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });
});

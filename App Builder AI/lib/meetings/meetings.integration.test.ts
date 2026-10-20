import { describe, expect, it, vi } from 'vitest';

import { prisma } from '@/tests/integration/db';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

import { cancelMeeting, confirmMeeting, createMeetingRequest, platformScope } from './service';

/** A mid-week 10:00 UTC slot about two weeks out, inside any default working hours. */
function futureSlot(hour = 10) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  while ([0, 5, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

async function request(label: string) {
  const { meeting } = await createMeetingRequest({
    scope: platformScope,
    category: 'CUSTOMER',
    title: `Call ${label}`,
    participants: [{ name: label, email: `${label}@example.test`, timeZone: 'UTC' }],
    sourceType: 'MANUAL',
    sourceId: `src-${label}`,
    idempotencyKey: `meeting-${label}`,
  });
  return meeting;
}

describe('meeting booking (real Postgres)', () => {
  it('returns the same meeting for a retried request instead of creating a duplicate', async () => {
    const first = await request('ann');
    const again = await createMeetingRequest({
      scope: platformScope,
      category: 'CUSTOMER',
      title: 'Call ann (retry)',
      participants: [{ name: 'ann', email: 'ann@example.test', timeZone: 'UTC' }],
      sourceType: 'MANUAL',
      sourceId: 'src-ann',
      idempotencyKey: 'meeting-ann',
    });
    expect(again.duplicate).toBe(true);
    expect(again.meeting.id).toBe(first.id);
    expect(await prisma.meeting.count()).toBe(1);
  });

  it('books one of two simultaneous requests for the same slot and rejects the other', async () => {
    const [a, b] = await Promise.all([request('amy'), request('bob')]);
    const slot = futureSlot();
    const results = await Promise.all([confirmMeeting(a.id, slot, 'tester'), confirmMeeting(b.id, slot, 'tester')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.code).toBe('TAKEN');
    expect(await prisma.meeting.count({ where: { status: 'CONFIRMED' } })).toBe(1);
    expect(await prisma.meetingSlotLock.count()).toBe(1);
  });

  it('never double-books under heavy contention and frees the slot on cancel', async () => {
    const meetings = await Promise.all(['m1', 'm2', 'm3', 'm4', 'm5'].map(request));
    const slot = futureSlot(11);
    const results = await Promise.all(meetings.map((m) => confirmMeeting(m.id, slot, 'tester')));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.meetingSlotLock.count()).toBe(1);

    const winnerId = meetings.find((_, i) => results[i].ok)!.id;
    const loserId = meetings.find((_, i) => !results[i].ok)!.id;
    expect((await confirmMeeting(winnerId, slot, 'tester')).ok).toBe(true);

    expect((await cancelMeeting(winnerId, 'tester', 'changed plans')).ok).toBe(true);
    expect(await prisma.meetingSlotLock.count()).toBe(0);
    expect((await confirmMeeting(loserId, slot, 'tester')).ok).toBe(true);
  });

  it('enforces the slot lock at the database level even if the application check is bypassed', async () => {
    const [a, b] = await Promise.all([request('db1'), request('db2')]);
    const startsAt = futureSlot(14);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    await prisma.meetingSlotLock.create({ data: { meetingId: a.id, resourceKey: 'PLATFORM:PLATFORM', startsAt, endsAt } });
    await expect(
      prisma.meetingSlotLock.create({ data: { meetingId: b.id, resourceKey: 'PLATFORM:PLATFORM', startsAt, endsAt } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

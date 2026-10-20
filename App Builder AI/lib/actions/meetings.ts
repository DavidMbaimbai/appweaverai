'use server';

import { getCachedSession } from '../auth/cached';
import { parseParticipants, MEETING_CATEGORIES, type MeetingCategory } from '../meetings/logic';
import { cancelMeeting, createMeetingRequest, platformScope, proposeSlots } from '../meetings/service';
import { prisma } from '../prisma';
import { rateLimit } from '../rate-limit';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A signed-in user asks the AppWeaver team for a meeting. The request is always theirs: they only ever see their own. */
export async function requestMeetingAction(input: { title: string; agenda?: string; timeZone?: string; projectId?: string | null; category?: string }): Promise<Result<{ meetingId: string; message: string }>> {
  const user = (await getCachedSession())?.user;
  if (!user?.id || !user.email) return { ok: false, error: 'Sign in to request a meeting.' };
  const limit = await rateLimit(`meeting-request:${user.id}`, 5, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Too many requests. Try again in ${limit.retryAfter}s.` };
  const title = String(input.title ?? '').trim().slice(0, 150);
  if (title.length < 3) return { ok: false, error: 'Tell us briefly what the meeting is about.' };
  const category: MeetingCategory = (MEETING_CATEGORIES as readonly string[]).includes(String(input.category)) && input.category !== 'INTERNAL' ? (input.category as MeetingCategory) : 'USER';

  let projectId: string | null = null;
  if (input.projectId) {
    const owned = await prisma.project.findFirst({ where: { id: input.projectId, deletedAt: null, OR: [{ createdById: user.id }, { workspace: { ownerId: user.id } }] }, select: { id: true } });
    projectId = owned?.id ?? null;
  }
  const participants = parseParticipants([{ name: user.name || user.email, email: user.email, timeZone: input.timeZone, role: 'REQUIRED', userId: user.id }]);
  const { meeting, duplicate } = await createMeetingRequest({
    scope: platformScope,
    category,
    title,
    participants,
    agenda: `${String(input.agenda ?? '').slice(0, 2000)}${projectId ? `\nProject: ${projectId}` : ''}`.trim(),
    sourceType: projectId ? 'PROJECT' : 'USER_REQUEST',
    sourceId: projectId ?? user.id,
    requestedById: user.id,
    timeZone: input.timeZone,
    idempotencyKey: `user:${user.id}:${projectId ?? 'none'}:${title.toLowerCase()}`,
  });
  if (!duplicate && meeting.status === 'REQUESTED') await proposeSlots(meeting.id, 'system').catch(() => undefined);
  return { ok: true, meetingId: meeting.id, message: duplicate ? 'You already have an open request for this.' : 'Request received. We will email you proposed times once the team has reviewed it.' };
}

export async function listMyMeetingsAction() {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return [];
  const rows = await prisma.meeting.findMany({
    where: { requestedById: userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, title: true, status: true, startsAt: true, timeZone: true, conferenceUrl: true },
  });
  return rows;
}

export async function cancelMyMeetingAction(meetingId: string): Promise<Result> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in first.' };
  const meeting = await prisma.meeting.findFirst({ where: { id: String(meetingId), requestedById: userId }, select: { id: true } });
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  const r = await cancelMeeting(meeting.id, userId, 'Cancelled by the requester.');
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

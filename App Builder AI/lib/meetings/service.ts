import { Prisma, type Meeting, type MeetingType } from '@/lib/generated/prisma/client';
import { isValidTimeZone } from '@/lib/ads/schedule';
import { eventIdFor, type Interval } from '@/lib/calendar/logic';
import { createEvent, deleteEvent, getEvent, updateEvent, type ConferenceKind } from '@/lib/calendar/providers';
import { getVerifiedConnection, withCalendar, withScopeLock } from '@/lib/calendar/service';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

import { computeAvailability, recheckSlot, scopeKeyOf, type Availability, type TypeRules } from './availability';
import { conferenceStatus, zoomProvider } from './conference';
import { onMeetingConfirmed, onMeetingFinished } from './hooks';
import {
  ACTIVE_STATUSES,
  OPEN_STATUSES,
  canTransition,
  formatInZone,
  idempotencyKeyFor,
  isHttpsUrl,
  parseParticipants,
  type MeetingCategory,
  type MeetingStatus,
  type Participant,
  type SourceType,
} from './logic';
import { audit, manageUrlFor, notifyInApp, queueCancellation, queueConfirmation, scheduleReminders } from './notify';

export type Scope = { scopeType: 'PLATFORM' | 'PROJECT'; scopeId: string };
export const platformScope: Scope = { scopeType: 'PLATFORM', scopeId: 'PLATFORM' };
export const projectScope = (projectId: string): Scope => ({ scopeType: 'PROJECT', scopeId: projectId });

const PROPOSAL_TTL_MS = 3 * 86_400_000;
const IN_FLIGHT_MS = 120_000;

export const TYPE_DEFAULTS: Record<MeetingCategory, { name: string; durationMin: number; requiresApproval: boolean; locationKind: string; reminderOffsetsMin: number[] }> = {
  INVESTOR: { name: 'Investor meeting', durationMin: 30, requiresApproval: true, locationKind: 'GOOGLE_MEET', reminderOffsetsMin: [1440, 60] },
  CUSTOMER: { name: 'Customer consultation', durationMin: 30, requiresApproval: false, locationKind: 'MANUAL_LINK', reminderOffsetsMin: [1440, 60] },
  USER: { name: 'Support call', durationMin: 20, requiresApproval: true, locationKind: 'MANUAL_LINK', reminderOffsetsMin: [60] },
  BUSINESS: { name: 'Business meeting', durationMin: 30, requiresApproval: true, locationKind: 'MANUAL_LINK', reminderOffsetsMin: [1440, 60] },
  INTERNAL: { name: 'Internal meeting', durationMin: 30, requiresApproval: false, locationKind: 'MANUAL_LINK', reminderOffsetsMin: [30] },
};

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function getOrCreateType(scope: Scope, category: MeetingCategory, typeId?: string | null): Promise<MeetingType> {
  if (typeId) {
    const t = await prisma.meetingType.findFirst({ where: { id: typeId, ...scope } });
    if (t) return t;
  }
  const key = category.toLowerCase();
  const found = await prisma.meetingType.findUnique({ where: { scopeType_scopeId_key: { ...scope, key } } });
  if (found) return found;
  const d = TYPE_DEFAULTS[category];
  try {
    return await prisma.meetingType.create({ data: { ...scope, key, category, ...d } });
  } catch (error) {
    if (isUniqueViolation(error)) return prisma.meetingType.findUniqueOrThrow({ where: { scopeType_scopeId_key: { ...scope, key } } });
    throw error;
  }
}

const rulesOf = (t: Pick<MeetingType, 'durationMin' | 'bufferBeforeMin' | 'bufferAfterMin' | 'minNoticeMin' | 'timeZone' | 'workingHours'>): TypeRules => ({
  durationMin: t.durationMin,
  bufferBeforeMin: t.bufferBeforeMin,
  bufferAfterMin: t.bufferAfterMin,
  minNoticeMin: t.minNoticeMin,
  timeZone: t.timeZone,
  workingHours: t.workingHours,
});

const staff = (m: Pick<Meeting, 'hostUserId' | 'assigneeId' | 'requestedById'>) => [m.hostUserId, m.assigneeId, m.requestedById].filter((v): v is string => Boolean(v));

export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string };
const fail = (code: string, error: string): { ok: false; code: string; error: string } => ({ ok: false, code, error });

// ---- Create -----------------------------------------------------------------------------------------------------

export type CreateMeetingInput = {
  scope: Scope;
  category: MeetingCategory;
  typeId?: string | null;
  title: string;
  participants: Participant[];
  agenda?: string;
  sourceType: SourceType;
  sourceId?: string | null;
  requestedById?: string | null;
  requestedByAgent?: boolean;
  hostUserId?: string | null;
  timeZone?: string;
  idempotencyKey?: string;
};

/**
 * Creates a REQUESTED meeting. Retries return the same row (idempotency key); a second open meeting for the same
 * source is not created, so agents and users cannot spawn unnecessary duplicates.
 */
export async function createMeetingRequest(input: CreateMeetingInput): Promise<{ meeting: Meeting; duplicate: boolean }> {
  const type = await getOrCreateType(input.scope, input.category, input.typeId);
  const key = input.idempotencyKey ?? idempotencyKeyFor([input.scope.scopeType, input.scope.scopeId, input.sourceType, input.sourceId ?? input.title, 'request']);
  const existing = await prisma.meeting.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { meeting: existing, duplicate: true };
  if (input.sourceId) {
    const open = await prisma.meeting.findFirst({ where: { ...input.scope, sourceType: input.sourceType, sourceId: input.sourceId, status: { in: OPEN_STATUSES } } });
    if (open) return { meeting: open, duplicate: true };
  }
  const participants = parseParticipants(input.participants);
  if (!participants.length) throw new Error('A meeting needs at least one participant.');
  const firstTz = participants[0].timeZone;
  const tz = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : firstTz && isValidTimeZone(firstTz) ? firstTz : type.timeZone;
  try {
    const meeting = await prisma.meeting.create({
      data: {
        ...input.scope,
        typeId: type.id,
        title: input.title.trim().slice(0, 200) || type.name,
        category: input.category,
        durationMin: type.durationMin,
        timeZone: tz,
        hostUserId: input.hostUserId ?? null,
        participants: participants as unknown as Prisma.InputJsonValue,
        agenda: (input.agenda ?? '').slice(0, 4000),
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        requestedById: input.requestedById ?? null,
        requestedByAgent: input.requestedByAgent ?? false,
        locationKind: type.locationKind,
        idempotencyKey: key,
      },
    });
    await audit(meeting.id, input.requestedByAgent ? 'agent' : input.requestedById ?? 'system', 'requested', { source: input.sourceType });
    await notifyInApp(staff(meeting), meeting.id, `Meeting requested: ${meeting.title}`);
    return { meeting, duplicate: false };
  } catch (error) {
    if (isUniqueViolation(error)) return { meeting: await prisma.meeting.findUniqueOrThrow({ where: { idempotencyKey: key } }), duplicate: true };
    throw error;
  }
}

async function load(id: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) return null;
  const scope: Scope = { scopeType: meeting.scopeType as Scope['scopeType'], scopeId: meeting.scopeId };
  const type = (meeting.typeId ? await prisma.meetingType.findUnique({ where: { id: meeting.typeId } }) : null) ?? (await getOrCreateType(scope, meeting.category as MeetingCategory));
  return { meeting, type, scopeKey: scopeKeyOf(meeting) };
}

// ---- Propose ------------------------------------------------------------------------------------------------------

export async function availabilityFor(meetingId: string, extraBusy?: Interval[][]): Promise<Availability> {
  const l = await load(meetingId);
  if (!l) return { ok: false, error: 'Meeting not found.' };
  return computeAvailability({ scopeKey: l.scopeKey, rules: rulesOf(l.type), extraBusy });
}

/** Stores up to `count` free slots as proposals. Nothing is sent to the participant yet. */
export async function proposeSlots(meetingId: string, actor: string, count = 3, extraBusy?: Interval[][]): Promise<Result<{ proposals: { id: string; startsAt: Date }[]; source: string }>> {
  const l = await load(meetingId);
  if (!l) return fail('NOT_FOUND', 'Meeting not found.');
  if (!['REQUESTED', 'PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'RESCHEDULED'].includes(l.meeting.status)) return fail('BAD_STATE', `Cannot propose times while ${l.meeting.status}.`);
  const avail = await computeAvailability({ scopeKey: l.scopeKey, rules: rulesOf(l.type), extraBusy, maxSlots: 200 });
  if (!avail.ok) return fail('UNVERIFIABLE', avail.error);
  if (!avail.slots.length) return fail('NO_SLOTS', 'No free times in the next two weeks.');
  // Spread proposals over different days so the participant gets a real choice.
  const picked: Date[] = [];
  const days = new Set<string>();
  for (const s of avail.slots) {
    const day = s.toISOString().slice(0, 10);
    if (days.has(day)) continue;
    days.add(day);
    picked.push(s);
    if (picked.length >= count) break;
  }
  for (const s of avail.slots) if (picked.length < count && !picked.includes(s)) picked.push(s);

  await prisma.meetingSlotProposal.updateMany({ where: { meetingId, status: { in: ['PROPOSED', 'ACCEPTED'] } }, data: { status: 'EXPIRED' } });
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  const rows = [];
  for (const start of picked) {
    const end = new Date(start.getTime() + l.type.durationMin * 60_000);
    rows.push(
      await prisma.meetingSlotProposal.upsert({
        where: { meetingId_startsAt: { meetingId, startsAt: start } },
        create: { meetingId, startsAt: start, endsAt: end, proposedBy: actor, expiresAt },
        update: { status: 'PROPOSED', expiresAt, endsAt: end, proposedBy: actor },
      }),
    );
  }
  if (l.meeting.status === 'REQUESTED') await prisma.meeting.updateMany({ where: { id: meetingId, status: 'REQUESTED' }, data: { status: 'PROPOSED' } });
  await audit(meetingId, actor, 'proposed', { count: rows.length, source: avail.source });
  return { ok: true, proposals: rows.map((r) => ({ id: r.id, startsAt: r.startsAt })), source: avail.source };
}

/** Emails the proposed times (a request for the participant's choice, not an invitation). Moves to AWAITING_CONFIRMATION. */
export async function sendProposals(meetingId: string, actor: string): Promise<Result<{ sent: number }>> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return fail('NOT_FOUND', 'Meeting not found.');
  if (!['PROPOSED', 'AWAITING_CONFIRMATION'].includes(meeting.status)) return fail('BAD_STATE', `Cannot send times while ${meeting.status}.`);
  const proposals = await prisma.meetingSlotProposal.findMany({ where: { meetingId, status: 'PROPOSED', expiresAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } });
  if (!proposals.length) return fail('NO_SLOTS', 'There are no live proposed times.');
  const recipients = parseParticipants(meeting.participants).filter((p) => p.email && p.role !== 'HOST');
  if (!recipients.length) return fail('NO_RECIPIENT', 'No participant has an email address.');
  let sent = 0;
  const errors: string[] = [];
  for (const p of recipients) {
    const tz = p.timeZone || meeting.timeZone;
    const url = manageUrlFor(meeting, p.email as string);
    const lines = proposals.map((x) => `- ${formatInZone(x.startsAt, tz)}`).join('\n');
    const text = `We would like to arrange "${meeting.title}" (${meeting.durationMin} minutes).\n\nPlease pick a time:\n${lines}\n\nChoose, or ask for other times, here: ${url}\n\nNothing is booked until you confirm.`;
    try {
      await sendEmail({ to: p.email as string, subject: `Choose a time: ${meeting.title}`, text, html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>` });
      sent++;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'send failed');
    }
  }
  if (!sent) {
    await audit(meetingId, 'system', 'proposal.email_failed', { errors });
    await notifyInApp(staff(meeting), meetingId, `Could not email proposed times for ${meeting.title}`, errors.join('; '));
    return fail('EMAIL_FAILED', 'The proposal email could not be sent.');
  }
  if (meeting.status === 'PROPOSED') await prisma.meeting.updateMany({ where: { id: meetingId, status: 'PROPOSED' }, data: { status: 'AWAITING_CONFIRMATION' } });
  await audit(meetingId, actor, 'proposal.sent', { sent, failed: errors.length });
  return { ok: true, sent };
}

// ---- Confirm and book ------------------------------------------------------------------------------------------------

async function syncCalendarEvent(meeting: Meeting, type: MeetingType, scopeKey: string, start: Date, end: Date) {
  const conn = await getVerifiedConnection(scopeKey);
  if (!conn) return { provider: null as string | null, eventId: meeting.externalEventId, conferenceUrl: null as string | null };
  const provider = conn.provider as 'GOOGLE' | 'MICROSOFT';
  const conference: ConferenceKind | null = meeting.locationKind === 'GOOGLE_MEET' && provider === 'GOOGLE' ? 'GOOGLE_MEET' : meeting.locationKind === 'TEAMS' && provider === 'MICROSOFT' ? 'TEAMS' : null;
  const input = {
    eventId: meeting.externalEventId ?? eventIdFor(`meeting:${meeting.id}`),
    title: meeting.title,
    description: [meeting.agenda, `Type: ${type.name}`].filter(Boolean).join('\n\n'),
    start,
    end,
    conference,
    location: meeting.locationKind === 'IN_PERSON' ? meeting.locationText : null,
    attendees: parseParticipants(meeting.participants).flatMap((p) => (p.email ? [p.email] : [])),
  };
  const result = await withCalendar(conn, (token) => (meeting.externalEventId ? updateEvent(provider, token, input, conn.calendarId) : createEvent(provider, token, input, conn.calendarId)));
  return { provider, eventId: result.eventId, conferenceUrl: conference && isHttpsUrl(result.conferenceUrl) ? result.conferenceUrl : null };
}

export type ConfirmOptions = { approvedBy?: string; participantAgreed?: boolean };
type ConfirmOk = { meeting: Meeting; duplicate?: boolean; notes: string[] };

/**
 * Confirm-then-book. Under a per-scope advisory lock the slot is re-checked against live free/busy and held slots,
 * then reserved with a unique lock row. Only after the calendar event (when a calendar is verified) exists is the
 * meeting CONFIRMED; any failure releases the reservation and the meeting is never reported as booked.
 */
export async function confirmMeeting(meetingId: string, startsAt: Date, actor: string, options: ConfirmOptions = {}): Promise<Result<ConfirmOk>> {
  const l = await load(meetingId);
  if (!l) return fail('NOT_FOUND', 'Meeting not found.');
  const { type, scopeKey } = l;
  const isActive = (m: Meeting) => ACTIVE_STATUSES.includes(m.status as MeetingStatus);
  if (isActive(l.meeting) && l.meeting.startsAt?.getTime() === startsAt.getTime()) return { ok: true, meeting: l.meeting, duplicate: true, notes: [] };
  if (!isActive(l.meeting) && !canTransition(l.meeting.status as MeetingStatus, 'CONFIRMED')) return fail('BAD_STATE', `A ${l.meeting.status} meeting cannot be confirmed.`);
  if (startsAt.getTime() <= Date.now()) return fail('PAST', 'That time has passed.');
  const end = new Date(startsAt.getTime() + type.durationMin * 60_000);

  const reserved = await withScopeLock(`meeting:${scopeKey}`, async (tx) => {
    const current = await tx.meeting.findUnique({ where: { id: meetingId } });
    if (!current) return 'NOT_FOUND' as const;
    if (isActive(current) && current.startsAt?.getTime() === startsAt.getTime()) return 'DUPLICATE' as const;
    const held = await tx.meetingSlotLock.findUnique({ where: { meetingId } });
    if (held && held.startsAt.getTime() === startsAt.getTime() && !isActive(current) && Date.now() - held.createdAt.getTime() < IN_FLIGHT_MS) return 'IN_PROGRESS' as const;
    const verdict = await recheckSlot({ scopeKey, rules: rulesOf(type), start: startsAt, end, excludeMeetingId: meetingId });
    if (verdict !== 'OK') return verdict;
    try {
      await tx.meetingSlotLock.upsert({ where: { meetingId }, create: { meetingId, resourceKey: scopeKey, startsAt, endsAt: end }, update: { startsAt, endsAt: end } });
    } catch (error) {
      if (isUniqueViolation(error)) return 'TAKEN' as const;
      throw error;
    }
    return 'OK' as const;
  });
  if (reserved === 'NOT_FOUND') return fail('NOT_FOUND', 'Meeting not found.');
  if (reserved === 'DUPLICATE') return { ok: true, meeting: (await prisma.meeting.findUnique({ where: { id: meetingId } })) as Meeting, duplicate: true, notes: [] };
  if (reserved === 'IN_PROGRESS') return fail('IN_PROGRESS', 'This booking is already being processed.');
  if (reserved === 'TAKEN') {
    await audit(meetingId, actor, 'confirm.slot_taken', { startsAt });
    return fail('TAKEN', 'That time was just taken. Please choose another.');
  }
  if (reserved === 'UNVERIFIABLE') return fail('UNVERIFIABLE', 'The calendar could not be checked, so the booking was not made.');

  const meeting = l.meeting;
  const notes: string[] = [];
  let { conferenceUrl, conferenceId, conferenceProvider } = meeting;
  let calendarProvider: string | null = meeting.calendarProvider;
  let externalEventId: string | null = meeting.externalEventId;
  try {
    if (meeting.locationKind === 'ZOOM' && !conferenceUrl) {
      if ((await conferenceStatus('ZOOM', scopeKey)).available) {
        try {
          const z = await zoomProvider.create({ topic: meeting.title, start: startsAt, durationMin: type.durationMin, timeZone: meeting.timeZone });
          conferenceUrl = z.url;
          conferenceId = z.id;
          conferenceProvider = 'ZOOM';
        } catch (error) {
          notes.push(`Zoom link could not be created (${error instanceof Error ? error.message : 'error'}); add a link manually.`);
        }
      } else notes.push('Zoom is unavailable; add a link manually.');
    }
    const ev = await syncCalendarEvent(meeting, type, scopeKey, startsAt, end);
    calendarProvider = ev.provider ?? calendarProvider;
    externalEventId = ev.eventId;
    if (ev.conferenceUrl) {
      conferenceUrl = ev.conferenceUrl;
      conferenceProvider = meeting.locationKind;
    } else if ((meeting.locationKind === 'GOOGLE_MEET' || meeting.locationKind === 'TEAMS') && !conferenceUrl) {
      notes.push(`${meeting.locationKind === 'TEAMS' ? 'Teams' : 'Google Meet'} did not return a link; the organiser must add one.`);
    }
  } catch (error) {
    if (!isActive(meeting)) await prisma.meetingSlotLock.deleteMany({ where: { meetingId } });
    else if (meeting.startsAt && meeting.endsAt) await prisma.meetingSlotLock.updateMany({ where: { meetingId }, data: { startsAt: meeting.startsAt, endsAt: meeting.endsAt } });
    const message = error instanceof Error ? error.message : 'Calendar error';
    await audit(meetingId, actor, 'confirm.failed', { error: message });
    await notifyInApp(staff(meeting), meetingId, `Booking failed: ${meeting.title}`, message);
    return fail('EVENT_FAILED', 'The calendar event could not be created, so nothing was booked.');
  }

  const rescheduled = isActive(meeting) || Boolean(meeting.externalEventId);
  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: rescheduled ? 'RESCHEDULED' : 'CONFIRMED',
      startsAt,
      endsAt: end,
      durationMin: type.durationMin,
      confirmedAt: new Date(),
      conferenceUrl,
      conferenceId,
      conferenceProvider,
      calendarProvider,
      externalEventId,
      locationText: conferenceUrl || meeting.locationKind === 'IN_PERSON' ? meeting.locationText : 'The organiser will share joining details.',
      failureReason: notes.join(' ') || null,
      tokenVersion: { increment: 1 },
    },
  });
  await prisma.meetingSlotProposal.updateMany({ where: { meetingId, status: { in: ['PROPOSED', 'ACCEPTED'] } }, data: { status: 'EXPIRED' } });
  await prisma.meetingSlotProposal.updateMany({ where: { meetingId, startsAt }, data: { status: 'ACCEPTED' } });
  await audit(meetingId, actor, rescheduled ? 'rescheduled' : 'confirmed', { startsAt, calendar: calendarProvider, approvedBy: options.approvedBy, participantAgreed: options.participantAgreed ?? false, notes });
  await queueConfirmation(updated);
  await scheduleReminders(updated, type.reminderOffsetsMin);
  await notifyInApp(staff(updated), updated.id, `Confirmed: ${updated.title}`, formatInZone(startsAt, updated.timeZone));
  await onMeetingConfirmed(updated).catch((error) => audit(meetingId, 'system', 'crm.update_failed', { error: error instanceof Error ? error.message : String(error) }));
  return { ok: true, meeting: updated, notes };
}

/** Participant picks one of the proposed times. Books immediately unless the type requires host approval. */
export async function chooseProposal(meetingId: string, proposalId: string, participantEmail: string): Promise<Result<{ status: string; meeting: Meeting }>> {
  const l = await load(meetingId);
  if (!l) return fail('NOT_FOUND', 'Meeting not found.');
  const proposal = await prisma.meetingSlotProposal.findFirst({ where: { id: proposalId, meetingId, status: 'PROPOSED', expiresAt: { gt: new Date() } } });
  if (!proposal) return fail('GONE', 'That time is no longer on offer.');
  if (l.type.requiresApproval) {
    await prisma.meetingSlotProposal.updateMany({ where: { meetingId, status: 'ACCEPTED' }, data: { status: 'PROPOSED' } });
    await prisma.meetingSlotProposal.update({ where: { id: proposal.id }, data: { status: 'ACCEPTED' } });
    await prisma.meeting.updateMany({ where: { id: meetingId, status: { in: ['REQUESTED', 'PROPOSED'] } }, data: { status: 'AWAITING_CONFIRMATION' } });
    await audit(meetingId, participantEmail, 'participant.chose', { startsAt: proposal.startsAt, awaitingHost: true });
    await notifyInApp(staff(l.meeting), meetingId, `Time chosen, approval needed: ${l.meeting.title}`, formatInZone(proposal.startsAt, l.meeting.timeZone));
    return { ok: true, status: 'AWAITING_CONFIRMATION', meeting: (await prisma.meeting.findUnique({ where: { id: meetingId } })) as Meeting };
  }
  const r = await confirmMeeting(meetingId, proposal.startsAt, participantEmail, { participantAgreed: true });
  if (!r.ok) return r;
  return { ok: true, status: r.meeting.status, meeting: r.meeting };
}

/** Host approval of the time the participant chose (or of an explicit time). */
export async function approveMeeting(meetingId: string, actor: string, startsAt?: Date): Promise<Result<{ meeting: Meeting; notes: string[] }>> {
  let start = startsAt;
  if (!start) {
    const accepted = await prisma.meetingSlotProposal.findFirst({ where: { meetingId, status: 'ACCEPTED' }, orderBy: { startsAt: 'asc' } });
    if (!accepted) return fail('NO_TIME', 'No time has been chosen by the participant yet.');
    start = accepted.startsAt;
  }
  const r = await confirmMeeting(meetingId, start, actor, { approvedBy: actor, participantAgreed: !startsAt });
  return r.ok ? { ok: true, meeting: r.meeting, notes: r.notes } : r;
}

// ---- Reschedule / cancel -----------------------------------------------------------------------------------------------

export async function rescheduleMeeting(meetingId: string, newStart: Date, actor: string): Promise<Result<{ meeting: Meeting; notes: string[] }>> {
  const l = await load(meetingId);
  if (!l) return fail('NOT_FOUND', 'Meeting not found.');
  if (!ACTIVE_STATUSES.includes(l.meeting.status as MeetingStatus)) return fail('BAD_STATE', 'Only confirmed meetings can be rescheduled; propose new times instead.');
  const r = await confirmMeeting(meetingId, newStart, actor);
  return r.ok ? { ok: true, meeting: r.meeting, notes: r.notes } : r;
}

/** Participant asks to move: fresh times are proposed and the meeting returns to the choose-a-time flow. */
export async function requestReschedule(meetingId: string, email: string): Promise<Result<{ proposals: number }>> {
  const l = await load(meetingId);
  if (!l) return fail('NOT_FOUND', 'Meeting not found.');
  if (!canTransition(l.meeting.status as MeetingStatus, 'PROPOSED')) return fail('BAD_STATE', `A ${l.meeting.status} meeting cannot be rescheduled.`);
  const r = await proposeSlots(meetingId, email, 3);
  if (!r.ok) return r;
  await prisma.meeting.updateMany({ where: { id: meetingId, status: { in: ['CONFIRMED', 'RESCHEDULED', 'REQUESTED'] } }, data: { status: 'PROPOSED' } });
  await audit(meetingId, email, 'participant.reschedule_requested');
  await notifyInApp(staff(l.meeting), meetingId, `Reschedule requested: ${l.meeting.title}`);
  return { ok: true, proposals: r.proposals.length };
}

export async function cancelMeeting(meetingId: string, actor: string, reason?: string): Promise<Result<{ meeting: Meeting; warnings: string[] }>> {
  const l = await load(meetingId);
  if (!l) return fail('NOT_FOUND', 'Meeting not found.');
  const { meeting, scopeKey } = l;
  if (meeting.status === 'CANCELLED') return { ok: true, meeting, warnings: [] };
  if (!canTransition(meeting.status as MeetingStatus, 'CANCELLED')) return fail('BAD_STATE', `A ${meeting.status} meeting cannot be cancelled.`);
  const warnings: string[] = [];
  if (meeting.externalEventId) {
    try {
      const conn = await getVerifiedConnection(scopeKey);
      if (conn) await withCalendar(conn, (token, p) => deleteEvent(p, token, meeting.externalEventId as string, conn.calendarId));
      else warnings.push('The calendar is not connected; delete the event manually.');
    } catch {
      warnings.push('The calendar event could not be removed automatically; delete it manually.');
    }
  }
  if (meeting.conferenceProvider === 'ZOOM' && meeting.conferenceId) {
    try {
      await zoomProvider.remove(meeting.conferenceId);
    } catch {
      warnings.push('The Zoom meeting could not be deleted automatically.');
    }
  }
  const wasBooked = Boolean(meeting.confirmedAt) && Boolean(meeting.startsAt);
  await prisma.meetingSlotLock.deleteMany({ where: { meetingId } });
  const updated = await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason?.slice(0, 500) ?? null, tokenVersion: { increment: 1 } } });
  await prisma.meetingReminder.updateMany({ where: { meetingId, status: 'PENDING' }, data: { status: 'SKIPPED', lastError: 'Meeting cancelled.' } });
  await prisma.meetingSlotProposal.updateMany({ where: { meetingId, status: { in: ['PROPOSED', 'ACCEPTED'] } }, data: { status: 'EXPIRED' } });
  await audit(meetingId, actor, 'cancelled', { reason, warnings });
  if (wasBooked) await queueCancellation(updated);
  return { ok: true, meeting: updated, warnings };
}

// ---- Staff operations ---------------------------------------------------------------------------------------------------

export async function assignMeeting(meetingId: string, assigneeId: string | null, actor: string) {
  await prisma.meeting.update({ where: { id: meetingId }, data: { assigneeId } });
  await audit(meetingId, actor, 'assigned', { assigneeId });
  if (assigneeId) await notifyInApp([assigneeId], meetingId, 'A meeting was assigned to you');
}

export async function setInternalNotes(meetingId: string, notes: string, actor: string) {
  await prisma.meeting.update({ where: { id: meetingId }, data: { internalNotes: notes.slice(0, 20_000), notesPurgedAt: null } });
  await audit(meetingId, actor, 'notes.updated');
}

export async function setManualLink(meetingId: string, url: string, actor: string): Promise<Result> {
  if (!isHttpsUrl(url)) return fail('BAD_LINK', 'Enter a valid https:// link.');
  await prisma.meeting.update({ where: { id: meetingId }, data: { conferenceUrl: url, conferenceProvider: 'MANUAL', locationText: null, failureReason: null } });
  await audit(meetingId, actor, 'link.manual');
  return { ok: true };
}

export type OutcomeInput = { status: 'COMPLETED' | 'MISSED'; outcome?: string; nextSteps?: { text: string; sensitive?: boolean }[]; transcriptConsent?: boolean };

export async function recordOutcome(meetingId: string, input: OutcomeInput, actor: string): Promise<Result<{ meeting: Meeting }>> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return fail('NOT_FOUND', 'Meeting not found.');
  if (!canTransition(meeting.status as MeetingStatus, input.status)) return fail('BAD_STATE', `Cannot mark a ${meeting.status} meeting as ${input.status}.`);
  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: input.status,
      outcome: input.outcome?.slice(0, 10_000) ?? null,
      nextSteps: (input.nextSteps ?? []) as unknown as Prisma.InputJsonValue,
      transcriptConsent: input.transcriptConsent ?? meeting.transcriptConsent,
    },
  });
  await prisma.meetingSlotLock.deleteMany({ where: { meetingId } });
  await audit(meetingId, actor, `outcome.${input.status.toLowerCase()}`);
  await onMeetingFinished(updated).catch((error) => audit(meetingId, 'system', 'crm.update_failed', { error: error instanceof Error ? error.message : String(error) }));
  return { ok: true, meeting: updated };
}

/** Wipes private notes/transcripts/outcomes of finished meetings older than the scope's retention period. */
export async function purgeRetention(now = new Date()) {
  const settings = await prisma.meetingSettings.findMany({ where: { retentionDays: { not: null } } });
  let purged = 0;
  for (const s of settings) {
    const days = s.retentionDays as number;
    const scope = s.scopeKey === 'PLATFORM' ? platformScope : projectScope(s.scopeKey);
    const r = await prisma.meeting.updateMany({
      where: { ...scope, notesPurgedAt: null, status: { in: ['COMPLETED', 'MISSED', 'CANCELLED'] }, updatedAt: { lt: new Date(now.getTime() - days * 86_400_000) } },
      data: { internalNotes: null, transcript: null, summary: null, outcome: null, notesPurgedAt: now },
    });
    purged += r.count;
  }
  return purged;
}

export async function setRetention(scopeKey: string, retentionDays: number | null) {
  const days = retentionDays && retentionDays > 0 ? Math.min(Math.floor(retentionDays), 3650) : null;
  await prisma.meetingSettings.upsert({ where: { scopeKey }, create: { scopeKey, retentionDays: days }, update: { retentionDays: days } });
}

// ---- Poll sync for external changes ----------------------------------------------------------------------------------------

/** Checks upcoming confirmed meetings against the calendar: external deletions cancel, external moves are mirrored. */
export async function syncMeetingsWithCalendar(limit = 50) {
  const rows = await prisma.meeting.findMany({
    where: { status: { in: ['CONFIRMED', 'RESCHEDULED'] }, externalEventId: { not: null }, endsAt: { gt: new Date() } },
    orderBy: { startsAt: 'asc' },
    take: limit,
  });
  let changed = 0;
  for (const m of rows) {
    const conn = await getVerifiedConnection(scopeKeyOf(m));
    if (!conn) continue;
    try {
      const ev = await withCalendar(conn, (token, p) => getEvent(p, token, m.externalEventId as string, conn.calendarId));
      if (!ev || ev.cancelled) {
        await prisma.meetingSlotLock.deleteMany({ where: { meetingId: m.id } });
        await prisma.meeting.update({ where: { id: m.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Removed from the calendar.', tokenVersion: { increment: 1 } } });
        await prisma.meetingReminder.updateMany({ where: { meetingId: m.id, status: 'PENDING' }, data: { status: 'SKIPPED', lastError: 'Meeting cancelled.' } });
        await audit(m.id, 'calendar', 'external.cancelled');
        await notifyInApp(staff(m), m.id, `Calendar event removed: ${m.title}`, 'Participants were not notified automatically.');
        changed++;
      } else if (m.startsAt && Math.abs(ev.start.getTime() - m.startsAt.getTime()) > 60_000) {
        await prisma.meetingSlotLock.updateMany({ where: { meetingId: m.id }, data: { startsAt: ev.start, endsAt: ev.end } });
        const moved = await prisma.meeting.update({ where: { id: m.id }, data: { status: 'RESCHEDULED', startsAt: ev.start, endsAt: ev.end, tokenVersion: { increment: 1 } } });
        await audit(m.id, 'calendar', 'external.moved', { to: ev.start });
        await queueConfirmation(moved);
        await scheduleReminders(moved, (await load(m.id))?.type.reminderOffsetsMin ?? []);
        changed++;
      }
    } catch {
      // Calendar unreachable or reconnect needed: leave the meeting untouched; the connection state is shown in the UI.
    }
  }
  return { checked: rows.length, changed };
}

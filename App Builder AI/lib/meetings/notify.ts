import type { Meeting } from '@/lib/generated/prisma/client';
import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { normalizeContact } from '@/lib/messaging/gates';
import { sendOutbound } from '@/lib/messaging/send';
import type { AgentScope } from '@/lib/agents/types';

import { formatInZone, parseParticipants, renderInvite, signMeetingToken, type Participant } from './logic';

const MAX_ATTEMPTS = 5;
const CONFIRM_BASE = -1;
const CANCEL_BASE = -1_000_000;

/** Negative offsets are transactional messages tied to a link version: confirmation (-v) and cancellation (-1e6-v). */
export const confirmationOffset = (version: number) => CONFIRM_BASE - version;
export const cancellationOffset = (version: number) => CANCEL_BASE - version;
export const reminderKind = (offsetMin: number) => (offsetMin <= CANCEL_BASE ? 'CANCELLATION' : offsetMin < 0 ? 'CONFIRMATION' : 'REMINDER');

const scopeOf = (m: Pick<Meeting, 'scopeType' | 'scopeId'>): AgentScope => (m.scopeType === 'PROJECT' ? { type: 'PROJECT', projectId: m.scopeId } : { type: 'PLATFORM' });
const staffIds = (m: Meeting) => [...new Set([m.hostUserId, m.assigneeId, m.requestedById].filter((v): v is string => Boolean(v)))];

export async function audit(meetingId: string, actor: string, action: string, detail?: unknown) {
  await prisma.meetingAudit.create({ data: { meetingId, actor, action, detail: detail === undefined ? undefined : JSON.parse(JSON.stringify(detail)) } });
}

export async function notifyInApp(userIds: string[], meetingId: string, title: string, body = '') {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await prisma.meetingNotification.createMany({ data: ids.map((userId) => ({ userId, meetingId, title: title.slice(0, 200), body: body.slice(0, 2000) })) });
}

export const manageUrlFor = (m: Meeting, email: string) => {
  const token = signMeetingToken(m.id, m.tokenVersion, email, new Date((m.endsAt ?? m.startsAt ?? new Date()).getTime() + 7 * 86_400_000));
  return `${appBaseUrl()}/meeting/${token}`;
};

const viewFor = (m: Meeting, manageUrl: string) => ({
  title: m.title,
  startsAt: m.startsAt as Date,
  durationMin: m.durationMin,
  timeZone: m.timeZone,
  participants: parseParticipants(m.participants),
  agenda: m.agenda,
  link: m.conferenceUrl,
  location: m.locationText,
  manageUrl,
});

/** Queues the confirmation email for the current link version. Idempotent: one row per version. */
export async function queueConfirmation(m: Meeting) {
  await prisma.meetingReminder.upsert({
    where: { meetingId_offsetMin_channel: { meetingId: m.id, offsetMin: confirmationOffset(m.tokenVersion), channel: 'EMAIL' } },
    create: { meetingId: m.id, offsetMin: confirmationOffset(m.tokenVersion), channel: 'EMAIL', dueAt: new Date() },
    update: {},
  });
}

export async function queueCancellation(m: Meeting) {
  await prisma.meetingReminder.upsert({
    where: { meetingId_offsetMin_channel: { meetingId: m.id, offsetMin: cancellationOffset(m.tokenVersion), channel: 'EMAIL' } },
    create: { meetingId: m.id, offsetMin: cancellationOffset(m.tokenVersion), channel: 'EMAIL', dueAt: new Date() },
    update: {},
  });
}

/** (Re)creates reminder rows for a confirmed meeting; rows already sent keep their state (unique per offset+channel). */
export async function scheduleReminders(m: Meeting, offsets: number[], now = new Date()) {
  if (!m.startsAt) return;
  const participants = parseParticipants(m.participants);
  const channels = ['EMAIL', 'IN_APP', ...(participants.some((p) => p.phone) ? ['WHATSAPP', 'SMS'] : [])];
  await prisma.meetingReminder.updateMany({ where: { meetingId: m.id, status: 'PENDING', offsetMin: { gte: 0 } }, data: { status: 'SKIPPED', lastError: 'Superseded by a new time.' } });
  for (const offset of [...new Set(offsets)].filter((o) => o > 0)) {
    const dueAt = new Date(m.startsAt.getTime() - offset * 60_000);
    if (dueAt <= now) continue;
    for (const channel of channels) {
      await prisma.meetingReminder.upsert({
        where: { meetingId_offsetMin_channel: { meetingId: m.id, offsetMin: offset, channel } },
        create: { meetingId: m.id, offsetMin: offset, channel, dueAt },
        update: { dueAt, status: 'PENDING', attempts: 0, lastError: null },
      });
    }
  }
}

type DeliveryResult = { delivered: number; failed: string[]; skipped: string[] };

async function emailParticipants(m: Meeting, rowId: string, kind: 'CONFIRMATION' | 'REMINDER' | 'CANCELLATION', offsetMin: number): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, failed: [], skipped: [] };
  const participants = parseParticipants(m.participants).filter((p) => p.email);
  for (const p of participants) {
    const email = p.email as string;
    const marker = `sent:${rowId}:${email}`;
    if (await prisma.meetingAudit.findFirst({ where: { meetingId: m.id, action: marker }, select: { id: true } })) {
      result.delivered++;
      continue;
    }
    try {
      let message: { subject: string; text: string; html: string };
      if (kind === 'CANCELLATION') {
        const text = `The meeting "${m.title}" scheduled for ${m.startsAt ? formatInZone(m.startsAt, p.timeZone || m.timeZone) : 'a time to be set'} has been cancelled.${m.cancelReason ? `\nReason: ${m.cancelReason}` : ''}`;
        message = { subject: `Cancelled: ${m.title}`, text, html: `<p>${text.replace(/\n/g, '<br>')}</p>` };
      } else {
        const view = { ...viewFor(m, manageUrlFor(m, email)), timeZone: p.timeZone || m.timeZone };
        const heading = kind === 'CONFIRMATION' ? 'Your meeting is confirmed' : `Reminder: your meeting starts in ${offsetMin >= 60 ? `${Math.round(offsetMin / 60)} hour(s)` : `${offsetMin} minutes`}`;
        message = renderInvite(view, heading);
      }
      await sendEmail({ to: email, ...message });
      await audit(m.id, 'system', marker);
      result.delivered++;
    } catch (error) {
      result.failed.push(`${email}: ${error instanceof Error ? error.message : 'send failed'}`.slice(0, 300));
    }
  }
  if (!participants.length) result.skipped.push('No participant has an email address.');
  return result;
}

async function messageParticipants(m: Meeting, channel: 'WHATSAPP' | 'SMS', offsetMin: number): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, failed: [], skipped: [] };
  for (const p of parseParticipants(m.participants).filter((x) => x.phone)) {
    const contactRef = normalizeContact(channel, p.phone as string);
    const conversation = await prisma.conversation.findFirst({
      where: { scopeType: m.scopeType === 'PROJECT' ? 'PROJECT' : 'PLATFORM', scopeId: m.scopeId, channel, contactRef },
      select: { id: true },
    });
    if (!conversation) {
      result.skipped.push(`${channel}: no existing consented conversation for ${p.name}.`);
      continue;
    }
    const body = `Reminder: "${m.title}" starts ${m.startsAt ? formatInZone(m.startsAt, p.timeZone || m.timeZone) : ''}${m.conferenceUrl ? `. Join: ${m.conferenceUrl}` : ''}. Manage: ${manageUrlFor(m, p.email || contactRef)}`;
    const sent = await sendOutbound({ conversationId: conversation.id, scope: scopeOf(m), body, purpose: 'lead', category: 'meeting_reminder' });
    if (sent.ok) result.delivered++;
    else if (sent.blocked) result.skipped.push(`${channel}: ${sent.error}`);
    else result.failed.push(`${channel}: ${sent.error}`);
  }
  void offsetMin;
  return result;
}

export type ProcessSummary = { processed: number; sent: number; skipped: number; failed: number; retrying: number };

/** Handles one due reminder/confirmation row. A row is claimed atomically so concurrent crons never double-send. */
export async function processReminder(rowId: string, now = new Date()): Promise<'SENT' | 'SKIPPED' | 'FAILED' | 'RETRY' | 'CLAIMED'> {
  const row = await prisma.meetingReminder.findUnique({ where: { id: rowId } });
  if (!row || row.status !== 'PENDING') return 'CLAIMED';
  const claim = await prisma.meetingReminder.updateMany({ where: { id: row.id, status: 'PENDING', attempts: row.attempts }, data: { attempts: { increment: 1 } } });
  if (claim.count !== 1) return 'CLAIMED';
  const finish = (status: 'SENT' | 'SKIPPED' | 'FAILED', lastError: string | null) =>
    prisma.meetingReminder.update({ where: { id: row.id }, data: { status, lastError, ...(status === 'SENT' ? { sentAt: now } : {}) } });

  const meeting = await prisma.meeting.findUnique({ where: { id: row.meetingId } });
  const kind = reminderKind(row.offsetMin);
  if (!meeting) {
    await finish('SKIPPED', 'Meeting no longer exists.');
    return 'SKIPPED';
  }
  const live = meeting.status === 'CONFIRMED' || meeting.status === 'RESCHEDULED';
  if ((kind === 'CANCELLATION' && meeting.status !== 'CANCELLED') || (kind !== 'CANCELLATION' && (!live || !meeting.startsAt))) {
    await finish('SKIPPED', `Not applicable while the meeting is ${meeting.status}.`);
    return 'SKIPPED';
  }
  if (kind === 'CONFIRMATION' && Math.abs(row.offsetMin + 1) !== meeting.tokenVersion) {
    await finish('SKIPPED', 'Superseded by a newer version of the meeting.');
    return 'SKIPPED';
  }
  if (kind === 'REMINDER' && meeting.startsAt && meeting.startsAt <= now) {
    await finish('SKIPPED', 'The meeting has already started.');
    return 'SKIPPED';
  }

  let outcome: DeliveryResult;
  try {
    if (row.channel === 'EMAIL') outcome = await emailParticipants(meeting, row.id, kind, row.offsetMin);
    else if (row.channel === 'IN_APP') {
      const text = kind === 'REMINDER' ? `Starts ${formatInZone(meeting.startsAt as Date, meeting.timeZone)}` : kind === 'CONFIRMATION' ? 'Meeting confirmed' : 'Meeting cancelled';
      await notifyInApp(staffIds(meeting), meeting.id, `${kind === 'REMINDER' ? 'Reminder' : kind === 'CONFIRMATION' ? 'Confirmed' : 'Cancelled'}: ${meeting.title}`, text);
      outcome = { delivered: 1, failed: [], skipped: [] };
    } else {
      if (row.channel === 'SMS' && (await prisma.meetingReminder.findFirst({ where: { meetingId: row.meetingId, offsetMin: row.offsetMin, channel: 'WHATSAPP', status: 'SENT' }, select: { id: true } }))) {
        await finish('SKIPPED', 'Already delivered over WhatsApp.');
        return 'SKIPPED';
      }
      outcome = await messageParticipants(meeting, row.channel as 'WHATSAPP' | 'SMS', row.offsetMin);
    }
  } catch (error) {
    outcome = { delivered: 0, failed: [error instanceof Error ? error.message : 'unexpected error'], skipped: [] };
  }

  if (outcome.failed.length) {
    const message = outcome.failed.join('; ').slice(0, 1000);
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await finish('FAILED', message);
      await audit(meeting.id, 'system', `${kind.toLowerCase()}.failed`, { channel: row.channel, error: message });
      await notifyInApp(staffIds(meeting), meeting.id, `Could not deliver ${kind.toLowerCase()} for ${meeting.title}`, message);
      return 'FAILED';
    }
    await prisma.meetingReminder.update({ where: { id: row.id }, data: { lastError: message, dueAt: new Date(now.getTime() + 2 ** row.attempts * 60_000) } });
    return 'RETRY';
  }
  if (!outcome.delivered) {
    await finish('SKIPPED', outcome.skipped.join('; ').slice(0, 1000) || 'Nothing to deliver.');
    return 'SKIPPED';
  }
  await finish('SENT', outcome.skipped.length ? outcome.skipped.join('; ').slice(0, 1000) : null);
  return 'SENT';
}

export async function processDueReminders(limit = 100, now = new Date()): Promise<ProcessSummary> {
  const due = await prisma.meetingReminder.findMany({ where: { status: 'PENDING', dueAt: { lte: now } }, orderBy: { dueAt: 'asc' }, take: limit, select: { id: true } });
  const summary: ProcessSummary = { processed: 0, sent: 0, skipped: 0, failed: 0, retrying: 0 };
  for (const { id } of due) {
    const r = await processReminder(id, now);
    if (r === 'CLAIMED') continue;
    summary.processed++;
    if (r === 'SENT') summary.sent++;
    else if (r === 'SKIPPED') summary.skipped++;
    else if (r === 'FAILED') summary.failed++;
    else summary.retrying++;
  }
  return summary;
}

export type { Participant };

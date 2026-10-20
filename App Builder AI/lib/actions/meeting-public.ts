'use server';

import { maybeAutoBook } from '../meetings/ai';
import { parseParticipants, verifyMeetingToken } from '../meetings/logic';
import { audit } from '../meetings/notify';
import { cancelMeeting, chooseProposal, requestReschedule, sendProposals } from '../meetings/service';
import { prisma } from '../prisma';
import { rateLimit } from '../rate-limit';

type PublicResult = { ok: true; message: string } | { ok: false; error: string };
const INVALID: PublicResult = { ok: false, error: 'This link is no longer valid. Use the most recent email we sent you.' };

/** A token is valid only for the meeting's current link version and only for an email that is a participant. */
async function authorise(token: string) {
  const claims = verifyMeetingToken(token);
  if (!claims) return null;
  const limit = await rateLimit(`meeting-link:${claims.m}`, 20, 10 * 60_000);
  if (!limit.ok) return null;
  const meeting = await prisma.meeting.findUnique({ where: { id: claims.m } });
  if (!meeting || meeting.tokenVersion !== claims.v) return null;
  if (!parseParticipants(meeting.participants).some((p) => p.email?.toLowerCase() === claims.e)) return null;
  return { meeting, email: claims.e };
}

export async function chooseMeetingTimeAction(token: string, proposalId: string): Promise<PublicResult> {
  const a = await authorise(token);
  if (!a) return INVALID;
  const r = await chooseProposal(a.meeting.id, String(proposalId), a.email);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.status === 'AWAITING_CONFIRMATION') {
    await maybeAutoBook(a.meeting.id).catch((error) => console.error('[meetings] auto-book failed:', error));
    return { ok: true, message: 'Thanks. Your choice is recorded; you will get a confirmation email once the host approves it.' };
  }
  return { ok: true, message: 'Your meeting is confirmed. A confirmation email is on its way.' };
}

export async function requestMeetingRescheduleAction(token: string): Promise<PublicResult> {
  const a = await authorise(token);
  if (!a) return INVALID;
  const r = await requestReschedule(a.meeting.id, a.email);
  if (!r.ok) return { ok: false, error: r.error };
  const sent = await sendProposals(a.meeting.id, a.email);
  return sent.ok ? { ok: true, message: 'We have emailed you new times to choose from.' } : { ok: true, message: 'Your request was recorded; the host will send you new times.' };
}

export async function cancelMeetingByParticipantAction(token: string): Promise<PublicResult> {
  const a = await authorise(token);
  if (!a) return INVALID;
  const r = await cancelMeeting(a.meeting.id, a.email, 'Cancelled by the participant.');
  if (!r.ok) return { ok: false, error: r.error };
  await audit(a.meeting.id, a.email, 'participant.cancelled');
  return { ok: true, message: 'The meeting has been cancelled.' };
}

import { notFound } from 'next/navigation';

import { ParticipantPanel } from '@/components/meetings/participant-panel';
import { formatInZone, parseParticipants, verifyMeetingToken } from '@/lib/meetings/logic';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

/** Participant page: shows only what that participant may see (no notes, no other participants' contact details). */
export default async function MeetingTokenPage({ params }: Props) {
  const { token } = await params;
  if (!process.env.DATABASE_URL) notFound();
  const claims = verifyMeetingToken(token);
  const meeting = claims ? await prisma.meeting.findUnique({ where: { id: claims.m } }) : null;
  const me = meeting && claims ? parseParticipants(meeting.participants).find((p) => p.email?.toLowerCase() === claims.e) : null;
  if (!claims || !meeting || !me || meeting.tokenVersion !== claims.v) {
    return (
      <main className="mx-auto max-w-md p-6 text-neutral-900">
        <h1 className="mb-2 text-xl font-semibold">This link is no longer valid</h1>
        <p>Meeting links stop working when the meeting changes. Please use the most recent email we sent you.</p>
      </main>
    );
  }
  const tz = me.timeZone || meeting.timeZone;
  const proposals =
    meeting.status === 'PROPOSED' || meeting.status === 'AWAITING_CONFIRMATION'
      ? await prisma.meetingSlotProposal.findMany({ where: { meetingId: meeting.id, status: 'PROPOSED', expiresAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } })
      : [];

  return (
    <main className="mx-auto max-w-md p-6 text-neutral-900">
      <h1 className="mb-1 text-2xl font-semibold">{meeting.title}</h1>
      <p className="mb-4 text-sm text-neutral-600">Status: {meeting.status.replace(/_/g, ' ').toLowerCase()}</p>
      {meeting.startsAt && ['CONFIRMED', 'RESCHEDULED'].includes(meeting.status) ? (
        <p className="mb-2">
          {formatInZone(meeting.startsAt, tz)} · {meeting.durationMin} minutes
        </p>
      ) : null}
      <p className="mb-2 text-sm">With: {parseParticipants(meeting.participants).map((p) => p.name).join(', ')}</p>
      {meeting.agenda ? <p className="mb-2 text-sm">Agenda: {meeting.agenda}</p> : null}
      {meeting.conferenceUrl && ['CONFIRMED', 'RESCHEDULED'].includes(meeting.status) ? (
        <p className="mb-2 text-sm">
          Join: <a className="underline" href={meeting.conferenceUrl} rel="noopener noreferrer">{meeting.conferenceUrl}</a>
        </p>
      ) : null}
      <ParticipantPanel
        token={token}
        status={meeting.status}
        slots={proposals.map((p) => ({ id: p.id, label: formatInZone(p.startsAt, tz) }))}
      />
    </main>
  );
}

'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { disconnect, PLATFORM_SCOPE_KEY, startConnect, verifyNow } from '@/lib/calendar/service';
import { summariseMeeting } from '@/lib/meetings/ai';
import { verifyZoom } from '@/lib/meetings/conference';
import {
  approveMeeting,
  assignMeeting,
  cancelMeeting,
  proposeSlots,
  recordOutcome,
  rescheduleMeeting,
  sendProposals,
  setInternalNotes,
  setManualLink,
  setRetention,
} from '@/lib/meetings/service';
import { prisma } from '@/lib/prisma';

const PATH = '/admin/meetings';

export type MeetingOp =
  | { op: 'accept'; meetingId: string }
  | { op: 'decline'; meetingId: string; reason?: string }
  | { op: 'reschedule'; meetingId: string; startsAt: string }
  | { op: 'cancel'; meetingId: string; reason?: string }
  | { op: 'assign'; meetingId: string; assigneeId: string | null }
  | { op: 'notes'; meetingId: string; notes: string }
  | { op: 'link'; meetingId: string; url: string }
  | { op: 'outcome'; meetingId: string; status: 'COMPLETED' | 'MISSED'; outcome?: string; nextSteps?: string; transcriptConsent?: boolean }
  | { op: 'summarise'; meetingId: string }
  | { op: 'verify-zoom' }
  | { op: 'retention'; days: number | null };

export type MeetingOpResult = { ok: true; message?: string } | { ok: false; error: string };

export async function startPlatformCalendarConnectAction(provider: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const auth = await requireAdmin('meetings:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  try {
    const url = await startConnect({ scopeKey: PLATFORM_SCOPE_KEY, userId: auth.admin.id, provider, returnTo: PATH });
    await recordAuditLog({ adminId: auth.admin.id, adminEmail: auth.admin.email, action: 'meetings.calendar.connect', targetType: 'CalendarConnection', targetId: PLATFORM_SCOPE_KEY, result: 'SUCCESS', reason: null });
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not start the connection.' };
  }
}

export async function platformCalendarOpAction(op: 'verify' | 'disconnect'): Promise<MeetingOpResult> {
  const auth = await requireAdmin('meetings:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  let error: string | null = null;
  if (op === 'verify') {
    const r = await verifyNow(PLATFORM_SCOPE_KEY);
    if (!r.ok) error = r.error;
  } else await disconnect(PLATFORM_SCOPE_KEY);
  await recordAuditLog({ adminId: auth.admin.id, adminEmail: auth.admin.email, action: `meetings.calendar.${op}`, targetType: 'CalendarConnection', targetId: PLATFORM_SCOPE_KEY, result: error ? 'FAILURE' : 'SUCCESS', reason: error });
  revalidatePath(PATH);
  return error ? { ok: false, error } : { ok: true };
}

/** Admin console only manages PLATFORM-scope meetings; customer-project meetings stay with their owners. */
export async function adminMeetingOpAction(input: MeetingOp): Promise<MeetingOpResult> {
  const auth = await requireAdmin('meetings:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  const admin = auth.admin;
  const actor = admin.id;

  let result: MeetingOpResult;
  let targetId: string | undefined;
  try {
    if (input.op === 'verify-zoom') {
      const r = await verifyZoom();
      result = r.ok ? { ok: true, message: 'Zoom verified.' } : { ok: false, error: r.error };
    } else if (input.op === 'retention') {
      await setRetention('PLATFORM', input.days);
      result = { ok: true };
    } else {
      targetId = String(input.meetingId);
      const meeting = await prisma.meeting.findFirst({ where: { id: targetId, scopeType: 'PLATFORM', scopeId: 'PLATFORM' }, select: { id: true, status: true } });
      if (!meeting) {
        result = { ok: false, error: 'Meeting not found.' };
      } else if ((input.op === 'notes' || input.op === 'summarise') && !hasPermission(admin.adminRole, 'meetings:notes')) {
        result = { ok: false, error: 'Private notes need the meetings:notes permission.' };
      } else if (input.op === 'accept') {
        const approved = await prisma.meetingSlotProposal.findFirst({ where: { meetingId: meeting.id, status: 'ACCEPTED' } });
        if (approved) {
          const r = await approveMeeting(meeting.id, actor);
          result = r.ok ? { ok: true, message: r.notes.join(' ') || 'Meeting confirmed.' } : { ok: false, error: r.error };
        } else {
          const p = await proposeSlots(meeting.id, actor);
          if (!p.ok) result = { ok: false, error: p.error };
          else {
            const s = await sendProposals(meeting.id, actor);
            result = s.ok ? { ok: true, message: 'Times sent to the participant.' } : { ok: false, error: s.error };
          }
        }
      } else if (input.op === 'decline' || input.op === 'cancel') {
        const r = await cancelMeeting(meeting.id, actor, input.reason ?? (input.op === 'decline' ? 'Declined by the host.' : undefined));
        result = r.ok ? { ok: true, message: r.warnings.join(' ') || undefined } : { ok: false, error: r.error };
      } else if (input.op === 'reschedule') {
        const when = new Date(input.startsAt);
        if (Number.isNaN(when.getTime())) result = { ok: false, error: 'Enter a valid date and time.' };
        else {
          const r = await rescheduleMeeting(meeting.id, when, actor);
          result = r.ok ? { ok: true, message: r.notes.join(' ') || undefined } : { ok: false, error: r.error };
        }
      } else if (input.op === 'assign') {
        await assignMeeting(meeting.id, input.assigneeId || null, actor);
        result = { ok: true };
      } else if (input.op === 'notes') {
        await setInternalNotes(meeting.id, input.notes, actor);
        result = { ok: true };
      } else if (input.op === 'link') {
        const r = await setManualLink(meeting.id, input.url, actor);
        result = r.ok ? { ok: true } : { ok: false, error: r.error };
      } else if (input.op === 'outcome') {
        const steps = (input.nextSteps ?? '').split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ text }));
        const r = await recordOutcome(meeting.id, { status: input.status, outcome: input.outcome, nextSteps: steps, transcriptConsent: input.transcriptConsent }, actor);
        result = r.ok ? { ok: true } : { ok: false, error: r.error };
      } else {
        const r = await summariseMeeting(meeting.id, actor);
        result = r.ok ? { ok: true, message: 'Summary created; sensitive items await approval.' } : { ok: false, error: r.error ?? 'Failed.' };
      }
    }
  } catch (error) {
    console.error('[admin/meetings] operation failed:', error);
    result = { ok: false, error: 'The operation failed. Nothing was changed that you can rely on; refresh and retry.' };
  }

  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `meetings.${input.op}`,
    targetType: 'Meeting',
    targetId: targetId ?? null,
    result: result.ok ? 'SUCCESS' : 'FAILURE',
    reason: result.ok ? null : result.error,
  });
  revalidatePath(PATH);
  return result;
}

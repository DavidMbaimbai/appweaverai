import { AdminMeetingsView, type AdminMeeting } from '@/components/meetings/admin-meetings-view';
import { AdminPageHeader } from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { calendarStatus, PLATFORM_SCOPE_KEY } from '@/lib/calendar/service';
import { conferenceStatus } from '@/lib/meetings/conference';
import { bucketsFor, formatInZone, parseParticipants } from '@/lib/meetings/logic';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const sourceHref = (type: string, id: string | null) => (type === 'INVESTOR' ? '/admin/outreach' : type === 'USER_REQUEST' && id ? `/admin/users/${id}` : null);

export default async function AdminMeetingsPage() {
  const auth = await requireAdmin('meetings:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'meetings:write');
  const canNotes = hasPermission(auth.admin.adminRole, 'meetings:notes');
  const now = new Date();

  const [rows, calendar, settings, providers] = await Promise.all([
    prisma.meeting.findMany({ where: { scopeType: 'PLATFORM', scopeId: 'PLATFORM' }, orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }], take: 300 }),
    calendarStatus(PLATFORM_SCOPE_KEY),
    prisma.meetingSettings.findUnique({ where: { scopeKey: 'PLATFORM' } }),
    Promise.all((['GOOGLE_MEET', 'TEAMS', 'ZOOM'] as const).map((k) => conferenceStatus(k, PLATFORM_SCOPE_KEY))),
  ]);

  const meetings: AdminMeeting[] = rows.map((m) => {
    const nextSteps = Array.isArray(m.nextSteps) ? (m.nextSteps as AdminMeeting['nextSteps']) : [];
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      category: m.category,
      when: m.startsAt ? formatInZone(m.startsAt, m.timeZone) : null,
      durationMin: m.durationMin,
      participants: parseParticipants(m.participants).map((p) => `${p.name}${p.timeZone ? ` (${p.timeZone})` : ''}`).join(', '),
      agenda: m.agenda,
      sourceType: m.sourceType,
      sourceHref: sourceHref(m.sourceType, m.sourceId),
      conferenceUrl: m.conferenceUrl,
      assigneeId: m.assigneeId,
      failureReason: m.failureReason,
      // Private notes only reach the browser for staff holding meetings:notes.
      internalNotes: canNotes ? m.internalNotes : null,
      outcome: m.outcome,
      summary: m.summary,
      nextSteps,
      buckets: bucketsFor({ status: m.status, category: m.category, startsAt: m.startsAt, nextSteps }, now, m.timeZone),
    };
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Meetings" description="AI-assisted scheduling for investors, users and customers. Nothing is booked or announced until a time is confirmed." />
      <AdminMeetingsView
        meetings={meetings}
        canWrite={canWrite}
        canNotes={canNotes}
        adminId={auth.admin.id}
        providers={providers}
        calendar={{
          integration: calendar.integration,
          reason: calendar.reason,
          accountLabel: calendar.connection?.accountLabel ?? null,
          status: calendar.connection?.status ?? null,
          googleConfigured: calendar.providers.GOOGLE.configured,
          microsoftConfigured: calendar.providers.MICROSOFT.configured,
        }}
        retentionDays={settings?.retentionDays ?? null}
      />
    </div>
  );
}

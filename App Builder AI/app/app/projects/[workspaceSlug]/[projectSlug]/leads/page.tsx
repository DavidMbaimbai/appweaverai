import { notFound } from 'next/navigation';

import { LeadsDashboard } from '@/components/app/leads/leads-dashboard';
import { getCachedSession } from '@/lib/auth/cached';
import { calendarStatus } from '@/lib/calendar/service';
import { importFormSubmissions } from '@/lib/leads/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectLeadsPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Idempotent: form submissions already in the CRM are skipped.
  await importFormSubmissions(project.id).catch(() => null);

  const [leads, slots, calendar] = await Promise.all([
    prisma.lead.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 6 },
        followUps: { where: { doneAt: null }, orderBy: { dueAt: 'asc' } },
        drafts: { where: { status: 'DRAFT' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
    prisma.leadAvailabilitySlot.findMany({
      where: { projectId: project.id, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 100,
      include: { booking: { select: { id: true, lead: { select: { name: true } } } } },
    }),
    calendarStatus(project.id),
  ]);

  const syncs = await prisma.calendarBookingSync.findMany({ where: { bookingId: { in: slots.flatMap((s) => (s.booking ? [s.booking.id] : [])) } }, select: { bookingId: true, status: true } });
  const syncStatus = new Map(syncs.map((s) => [s.bookingId, s.status]));

  return (
    <LeadsDashboard
      projectId={project.id}
      projectName={project.name}
      growthHref={`/app/projects/${workspaceSlug}/${projectSlug}/growth`}
      leads={leads.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        source: l.source,
        utm: (l.utm as Record<string, string> | null) ?? null,
        status: l.status,
        score: l.score,
        scoreReasons: Array.isArray(l.scoreReasons) ? (l.scoreReasons as string[]) : [],
        suggestedAction: l.suggestedAction,
        notes: l.notes,
        consent: l.consent,
        optedOut: l.optedOut,
        createdAt: l.createdAt.toISOString(),
        activities: l.activities.map((a) => ({ id: a.id, type: a.type, detail: a.detail, createdAt: a.createdAt.toISOString() })),
        followUps: l.followUps.map((f) => ({ id: f.id, dueAt: f.dueAt.toISOString(), note: f.note })),
        draft: l.drafts[0] ? { id: l.drafts[0].id, subject: l.drafts[0].subject, body: l.drafts[0].body } : null,
      }))}
      calendar={calendar}
      slots={slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), durationMin: s.durationMin, bookedBy: s.booking?.lead.name ?? null, bookingId: s.booking?.id ?? null, bookingStatus: s.booking ? (syncStatus.get(s.booking.id) ?? 'PENDING_MANUAL_CONFIRMATION') : null }))}
    />
  );
}

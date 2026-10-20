import { notFound } from 'next/navigation';

import { BookingForm } from '@/components/app/leads/booking-form';
import { listCalendarSlots } from '@/lib/calendar/bookings';
import { SLOT_PREFIX } from '@/lib/calendar/logic';
import { listOpenSlots } from '@/lib/leads/service';
import { findPublicProject } from '@/lib/project-reviews/public-api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ projectId: string }> };

export default async function BookDemoPage({ params }: Props) {
  const { projectId } = await params;
  if (!process.env.DATABASE_URL) notFound();
  const project = await findPublicProject(projectId);
  if (!project) notFound();
  const calendar = await listCalendarSlots(projectId);
  const slots = calendar
    ? calendar.starts.slice(0, 60).map((d) => ({ id: `${SLOT_PREFIX}${d.toISOString()}`, startsAt: d, durationMin: calendar.durationMin }))
    : await listOpenSlots(projectId);

  return (
    <main className="mx-auto max-w-md p-6 text-neutral-900">
      <h1 className="mb-4 text-2xl font-semibold">Book a demo with {project.name}</h1>
      <BookingForm
        projectId={projectId}
        projectName={project.name}
        slots={slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), durationMin: s.durationMin }))}
      />
    </main>
  );
}

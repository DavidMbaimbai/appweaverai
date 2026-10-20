import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { listCalendarSlots } from '@/lib/calendar/bookings';
import { SLOT_PREFIX } from '@/lib/calendar/logic';
import { sendBookingConfirmation } from '@/lib/leads/email';
import { isEmail } from '@/lib/leads/logic';
import { BookingError, bookSlot, listOpenSlots } from '@/lib/leads/service';
import { CORS_HEADERS, findPublicProject, json, limited } from '@/lib/project-reviews/public-api';

type Ctx = { params: Promise<{ projectId: string }> };

const bookSchema = z.object({
  slotId: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).refine(isEmail, 'Invalid email'),
  phone: z.string().trim().max(40).optional(),
  consent: z.boolean().optional(),
  website: z.string().max(500).optional(),
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Open future slots only; never exposes who booked what or any calendar details. */
export async function GET(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const limit = await limited(request, 'bookings-get', projectId, 60, 60_000);
  if (limit) return limit;
  if (!(await findPublicProject(projectId))) return json({ error: 'Project not found.' }, 404);
  const calendar = await listCalendarSlots(projectId);
  if (calendar) {
    const slots = calendar.starts.slice(0, 60).map((d) => ({ id: `${SLOT_PREFIX}${d.toISOString()}`, startsAt: d, durationMin: calendar.durationMin }));
    return json({ slots, calendar: 'AVAILABLE', confirmation: 'AUTOMATIC' }, 200, { 'cache-control': 'no-store' });
  }
  const slots = await listOpenSlots(projectId);
  return json({ slots, calendar: 'UNAVAILABLE', confirmation: 'MANUAL' }, 200, { 'cache-control': 'no-store' });
}

export async function POST(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const limit = await limited(request, 'bookings-post', projectId, 5, 60 * 60_000);
  if (limit) return limit;

  const project = await findPublicProject(projectId);
  if (!project) return json({ error: 'Project not found.' }, 404);

  const parsed = bookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Please provide your name, a valid email and a time slot.' }, 400);
  const input = parsed.data;
  if (input.website?.trim()) return json({ success: true });

  try {
    const { slot, status } = await bookSlot(projectId, input.slotId, input);
    const owner = await prisma.project.findUnique({
      where: { id: projectId },
      select: { notificationEmail: true, createdBy: { select: { email: true } } },
    });
    await sendBookingConfirmation({
      to: input.email,
      name: input.name,
      businessName: project.name,
      startsAt: slot.startsAt,
      durationMin: slot.durationMin,
      ownerEmail: owner?.notificationEmail || owner?.createdBy.email || null,
      pendingConfirmation: status !== 'CONFIRMED',
    });
    return json({ success: true, status, startsAt: slot.startsAt, durationMin: slot.durationMin });
  } catch (error) {
    if (error instanceof BookingError) return json({ error: error.message }, error.status);
    console.error('[bookings] failed:', error);
    return json({ error: 'Could not book right now.' }, 500);
  }
}

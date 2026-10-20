'use server';

import { revalidatePath } from 'next/cache';

import { getCachedSession } from '../auth/cached';
import { cancelBooking, rescheduleBooking } from '../calendar/bookings';
import { disconnect, saveSettings, startConnect, verifyNow, type CalendarSettings } from '../calendar/service';
import { rateLimit } from '../rate-limit';
import { prisma } from '../prisma';
import { projectOwnerAccessOr } from '../projects/access';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const UNAUTHORIZED = { ok: false, error: 'Only the project owner can manage the calendar connection.' } as const;

/** The connection belongs to the project owner: the project creator or the workspace owner. */
async function ownerProject(projectId: string) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, OR: projectOwnerAccessOr(userId) },
    select: { id: true, slug: true, workspace: { select: { slug: true } } },
  });
  return project ? { userId, project } : null;
}

export async function startCalendarConnectAction(projectId: string, provider: string): Promise<Result<{ url: string }>> {
  const ctx = await ownerProject(projectId);
  if (!ctx) return UNAUTHORIZED;
  const limit = await rateLimit(`calendar-connect:${ctx.userId}`, 20, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Too many attempts. Try again in ${limit.retryAfter}s.` };
  try {
    const url = await startConnect({
      scopeKey: projectId,
      userId: ctx.userId,
      provider,
      returnTo: `/app/projects/${ctx.project.workspace.slug}/${ctx.project.slug}/leads`,
    });
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not start the connection.' };
  }
}

export async function disconnectCalendarAction(projectId: string): Promise<Result> {
  if (!(await ownerProject(projectId))) return UNAUTHORIZED;
  await disconnect(projectId);
  revalidatePath('/app/projects');
  return { ok: true };
}

export async function verifyCalendarAction(projectId: string): Promise<Result> {
  if (!(await ownerProject(projectId))) return UNAUTHORIZED;
  const res = await verifyNow(projectId);
  revalidatePath('/app/projects');
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function saveCalendarSettingsAction(projectId: string, settings: CalendarSettings): Promise<Result> {
  if (!(await ownerProject(projectId))) return UNAUTHORIZED;
  const res = await saveSettings(projectId, settings ?? {});
  revalidatePath('/app/projects');
  return res;
}

export async function cancelBookingAction(projectId: string, bookingId: string): Promise<Result<{ warning?: string }>> {
  if (!(await ownerProject(projectId))) return UNAUTHORIZED;
  const res = await cancelBooking(projectId, String(bookingId));
  revalidatePath('/app/projects');
  return res.ok ? { ok: true, warning: res.warning } : { ok: false, error: res.error ?? 'Could not cancel.' };
}

export async function rescheduleBookingAction(projectId: string, bookingId: string, newStartIso: string): Promise<Result> {
  if (!(await ownerProject(projectId))) return UNAUTHORIZED;
  const start = new Date(newStartIso);
  if (Number.isNaN(start.getTime())) return { ok: false, error: 'Invalid time.' };
  const res = await rescheduleBooking(projectId, String(bookingId), start);
  revalidatePath('/app/projects');
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'Could not reschedule.' };
}

import type { CalendarConnection, Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { eventIdFor, generateSlots, isStartBookable, mergeIntervals, slotClashes, type Interval, type SlotRules } from './logic';
import { createEvent, deleteEvent, getEvent, updateEvent, CalendarApiError, CalendarAuthError, isCalendarProvider } from './providers';
import { busyIntervals, connectionRules, getVerifiedConnection, isVerified, verifyNow, withCalendar, withScopeLock } from './service';

export const BOOKING_HORIZON_DAYS = 14;
const MAX_ATTEMPTS = 5;

export type SlotCheck = 'OK' | 'TAKEN' | 'UNVERIFIABLE';

/** Booked slots in our own DB also count as busy (covers bookings whose calendar event is still pending). */
async function dbBusy(db: Prisma.TransactionClient | typeof prisma, projectId: string, range: Interval, excludeBookingId?: string): Promise<Interval[]> {
  const rows = await db.leadAvailabilitySlot.findMany({
    where: { projectId, startsAt: { lt: range.end }, booking: excludeBookingId ? { is: { id: { not: excludeBookingId } } } : { isNot: null } },
    select: { startsAt: true, durationMin: true },
  });
  return rows.map((r) => ({ start: r.startsAt, end: new Date(r.startsAt.getTime() + r.durationMin * 60_000) })).filter((i) => i.end > range.start);
}

function rulesFor(conn: CalendarConnection, busy: Interval[], now: Date, durationMin = conn.durationMin): SlotRules {
  return { ...connectionRules(conn), durationMin, now, days: BOOKING_HORIZON_DAYS, busy };
}

/** Open times from working hours minus calendar busy time. Null when the calendar cannot be read (never guess). */
export async function listCalendarSlots(projectId: string, now = new Date()) {
  const conn = await getVerifiedConnection(projectId);
  if (!conn) return null;
  const range = { start: now, end: new Date(now.getTime() + (BOOKING_HORIZON_DAYS + 1) * 86_400_000) };
  try {
    const busy = [...(await busyIntervals(conn, range)), ...(await dbBusy(prisma, projectId, range))];
    return { durationMin: conn.durationMin, starts: generateSlots(rulesFor(conn, busy, now)) };
  } catch (error) {
    console.error('[calendar] availability failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** The conflict re-check performed immediately before a booking is confirmed. */
export async function checkSlotFree(
  tx: Prisma.TransactionClient,
  conn: CalendarConnection,
  projectId: string,
  start: Date,
  durationMin: number,
  opts: { enforceHours: boolean; excludeBookingId?: string; now?: Date } = { enforceHours: true },
): Promise<SlotCheck> {
  const now = opts.now ?? new Date();
  const range = { start: new Date(start.getTime() - 86_400_000), end: new Date(start.getTime() + durationMin * 60_000 + 86_400_000) };
  let busy: Interval[];
  try {
    busy = [...(await busyIntervals(conn, range)), ...(await dbBusy(tx, projectId, range, opts.excludeBookingId))];
  } catch {
    return 'UNVERIFIABLE';
  }
  const rules = rulesFor(conn, busy, now, durationMin);
  if (opts.enforceHours) return isStartBookable(start, rules) ? 'OK' : 'TAKEN';
  const end = new Date(start.getTime() + durationMin * 60_000);
  return slotClashes({ start, end }, rules, mergeIntervals(busy)) ? 'TAKEN' : 'OK';
}

export async function recordBookingSync(
  tx: Prisma.TransactionClient,
  input: { bookingId: string; scopeKey: string; start: Date; durationMin: number; provider: string | null },
) {
  return tx.calendarBookingSync.create({
    data: {
      bookingId: input.bookingId,
      scopeKey: input.scopeKey,
      provider: input.provider,
      status: 'PENDING_MANUAL_CONFIRMATION',
      startsAt: input.start,
      endsAt: new Date(input.start.getTime() + input.durationMin * 60_000),
      retryCreate: input.provider !== null,
    },
  });
}

const log = (leadId: string, type: string, detail: string) => prisma.leadActivity.create({ data: { leadId, type, detail: detail.slice(0, 2000) } });

/**
 * Creates the real calendar event for a booking. Idempotent: the provider event id is derived from the booking id,
 * so retries return the existing event. Anything short of a real event leaves the booking PENDING_MANUAL_CONFIRMATION.
 */
export async function createBookingEvent(bookingId: string): Promise<'CONFIRMED' | 'PENDING_MANUAL_CONFIRMATION'> {
  const sync = await prisma.calendarBookingSync.findUnique({ where: { bookingId } });
  if (!sync) return 'PENDING_MANUAL_CONFIRMATION';
  if (sync.status === 'CONFIRMED') return 'CONFIRMED';
  if (sync.status === 'CANCELLED') return 'PENDING_MANUAL_CONFIRMATION';
  const conn = await getVerifiedConnection(sync.scopeKey);
  const booking = await prisma.leadBooking.findUnique({ where: { id: bookingId }, include: { lead: { select: { id: true, name: true, email: true, phone: true } } } });
  if (!conn || !booking) {
    await prisma.calendarBookingSync.update({ where: { id: sync.id }, data: { retryCreate: false } });
    return 'PENDING_MANUAL_CONFIRMATION';
  }
  try {
    const event = await withCalendar(conn, (token, p) =>
      createEvent(
        p,
        token,
        {
          eventId: eventIdFor(`lead-booking:${bookingId}`),
          title: `Demo: ${booking.lead.name}`,
          description: `Booked via AppWeaver.\n${booking.lead.name}${booking.lead.email ? ` <${booking.lead.email}>` : ''}${booking.lead.phone ? `\n${booking.lead.phone}` : ''}`,
          start: sync.startsAt,
          end: sync.endsAt,
        },
        conn.calendarId,
      ),
    );
    await prisma.calendarBookingSync.update({
      where: { id: sync.id },
      data: { status: 'CONFIRMED', externalEventId: event.eventId, retryCreate: false, lastError: null, lastSyncedAt: new Date(), attempts: { increment: 1 } },
    });
    await log(booking.lead.id, 'CALENDAR_CONFIRMED', `Calendar event created (${conn.provider}).`);
    return 'CONFIRMED';
  } catch (error) {
    const auth = error instanceof CalendarAuthError;
    const message = error instanceof Error ? error.message : 'Calendar error';
    const attempts = sync.attempts + 1;
    await prisma.calendarBookingSync.update({
      where: { id: sync.id },
      data: { attempts, lastError: message.slice(0, 300), retryCreate: !auth && attempts < MAX_ATTEMPTS },
    });
    await log(booking.lead.id, 'CALENDAR_PENDING', auth ? 'Calendar needs reconnecting; booking awaits manual confirmation.' : 'Calendar event could not be created yet; will retry.');
    return 'PENDING_MANUAL_CONFIRMATION';
  }
}

/** Cancels a booking: frees the slot and removes the calendar event. A failed event delete is reported, never hidden. */
export async function cancelBooking(projectId: string, bookingId: string): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const booking = await prisma.leadBooking.findFirst({ where: { id: bookingId, slot: { projectId } }, include: { slot: true } });
  if (!booking) return { ok: false, error: 'Booking not found.' };
  const sync = await prisma.calendarBookingSync.findUnique({ where: { bookingId } });
  let warning: string | undefined;
  if (sync?.status === 'CONFIRMED' && sync.externalEventId) {
    const conn = await prisma.calendarConnection.findUnique({ where: { scopeKey: sync.scopeKey } });
    if (!conn || !conn.refreshTokenEnc) warning = 'The calendar is disconnected; remove the event from your calendar manually.';
    else {
      try {
        await withCalendar(conn, (token, p) => deleteEvent(p, token, sync.externalEventId!, conn.calendarId));
      } catch {
        warning = 'The calendar event could not be removed automatically; delete it manually.';
      }
    }
  }
  if (sync) await prisma.calendarBookingSync.update({ where: { id: sync.id }, data: { status: 'CANCELLED', retryCreate: false, lastSyncedAt: new Date() } });
  await log(booking.leadId, 'BOOKING_CANCELLED', `Booking ${booking.slot.startsAt.toISOString()} cancelled.`);
  // Deleting the slot cascades to the booking; owner-defined slots stay open for reuse.
  if (sync?.provider) await prisma.leadAvailabilitySlot.delete({ where: { id: booking.slotId } });
  else await prisma.leadBooking.delete({ where: { id: booking.id } });
  return { ok: true, warning };
}

/** Moves a booking. Re-checks the new time, then updates the provider event; the DB changes only if that succeeds. */
export async function rescheduleBooking(projectId: string, bookingId: string, newStart: Date): Promise<{ ok: boolean; error?: string }> {
  return withScopeLock(`lead-book:${projectId}`, async (tx) => {
    const booking = await tx.leadBooking.findFirst({ where: { id: bookingId, slot: { projectId } }, include: { slot: true, lead: { select: { id: true, name: true } } } });
    const sync = booking ? await tx.calendarBookingSync.findUnique({ where: { bookingId } }) : null;
    if (!booking || !sync) return { ok: false, error: 'Booking not found.' };
    const conn = await getVerifiedConnection(projectId);
    if (!conn) return { ok: false, error: 'Calendar is unavailable; reconnect it before rescheduling.' };
    const check = await checkSlotFree(tx, conn, projectId, newStart, booking.slot.durationMin, { enforceHours: true, excludeBookingId: bookingId });
    if (check === 'UNVERIFIABLE') return { ok: false, error: 'Could not verify the calendar. Nothing was changed.' };
    if (check === 'TAKEN') return { ok: false, error: 'That time is not free.' };
    const end = new Date(newStart.getTime() + booking.slot.durationMin * 60_000);
    if (sync.status === 'CONFIRMED' && sync.externalEventId) {
      try {
        await withCalendar(conn, (token, p) =>
          updateEvent(p, token, { eventId: sync.externalEventId!, title: `Demo: ${booking.lead.name}`, description: 'Rescheduled via AppWeaver.', start: newStart, end }, conn.calendarId),
        );
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Calendar update failed.' };
      }
    }
    await tx.leadAvailabilitySlot.update({ where: { id: booking.slotId }, data: { startsAt: newStart } });
    await tx.calendarBookingSync.update({ where: { id: sync.id }, data: { startsAt: newStart, endsAt: end, lastSyncedAt: new Date() } });
    await tx.leadActivity.create({ data: { leadId: booking.leadId, type: 'BOOKING_RESCHEDULED', detail: `Moved to ${newStart.toISOString()}` } });
    return { ok: true };
  });
}

/** Poll sync: detects events deleted/moved in the calendar, retries pending event creation, re-verifies the connection. */
export async function pollCalendarSync(limit = 25) {
  const stats = { connections: 0, verified: 0, cancelled: 0, moved: 0, created: 0, failed: 0 };
  await prisma.calendarOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const conns = await prisma.calendarConnection.findMany({ where: { status: { in: ['CONNECTED', 'PENDING'] } }, orderBy: { lastSyncAt: 'asc' }, take: limit });
  for (const conn of conns) {
    stats.connections++;
    try {
      if (!isCalendarProvider(conn.provider) || !conn.refreshTokenEnc) continue;
      const v = await verifyNow(conn.scopeKey);
      if (!v.ok) {
        stats.failed++;
        continue;
      }
      stats.verified++;
      const fresh = await prisma.calendarConnection.findUnique({ where: { id: conn.id } });
      if (!isVerified(fresh)) continue;
      const rows = await prisma.calendarBookingSync.findMany({ where: { scopeKey: conn.scopeKey, status: 'CONFIRMED', endsAt: { gt: new Date(Date.now() - 86_400_000) }, externalEventId: { not: null } }, take: 100 });
      for (const row of rows) {
        const ev = await withCalendar(fresh, (token, p) => getEvent(p, token, row.externalEventId!, fresh.calendarId));
        const booking = await prisma.leadBooking.findUnique({ where: { id: row.bookingId }, include: { slot: true } });
        if (!booking) continue;
        if (!ev || ev.cancelled) {
          await prisma.calendarBookingSync.update({ where: { id: row.id }, data: { status: 'CANCELLED', lastError: 'Removed in the calendar', lastSyncedAt: new Date() } });
          await log(booking.leadId, 'BOOKING_CANCELLED', 'The calendar event was removed in the calendar; booking cancelled.');
          await prisma.leadAvailabilitySlot.delete({ where: { id: booking.slotId } });
          stats.cancelled++;
        } else if (Math.abs(ev.start.getTime() - row.startsAt.getTime()) > 60_000) {
          await prisma.leadAvailabilitySlot.update({ where: { id: booking.slotId }, data: { startsAt: ev.start } });
          await prisma.calendarBookingSync.update({ where: { id: row.id }, data: { startsAt: ev.start, endsAt: ev.end, lastSyncedAt: new Date() } });
          await log(booking.leadId, 'BOOKING_RESCHEDULED', `Moved in the calendar to ${ev.start.toISOString()}.`);
          stats.moved++;
        }
      }
      const retry = await prisma.calendarBookingSync.findMany({ where: { scopeKey: conn.scopeKey, retryCreate: true, status: 'PENDING_MANUAL_CONFIRMATION', attempts: { lt: MAX_ATTEMPTS } }, take: 20 });
      for (const row of retry) {
        if ((await createBookingEvent(row.bookingId)) === 'CONFIRMED') stats.created++;
      }
      await prisma.calendarConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    } catch (error) {
      stats.failed++;
      if (!(error instanceof CalendarAuthError || error instanceof CalendarApiError)) console.error('[calendar-sync] unexpected:', error);
    }
  }
  return stats;
}

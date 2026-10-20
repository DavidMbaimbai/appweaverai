import { prisma } from '@/lib/prisma';
import { isValidTimeZone } from '@/lib/ads/schedule';
import {
  DEFAULT_WORKING_HOURS,
  generateSlots,
  mergeIntervals,
  parseWorkingHours,
  slotClashes,
  type Interval,
  type WorkingHours,
} from '@/lib/calendar/logic';
import { busyIntervals, connectionRules, getVerifiedConnection } from '@/lib/calendar/service';

export type MeetingScope = { type: 'PLATFORM' } | { type: 'PROJECT'; projectId: string };

/** Calendar scope key: the project id, or PLATFORM. */
export const scopeKeyOf = (scope: { scopeType: string; scopeId: string }) => (scope.scopeType === 'PROJECT' ? scope.scopeId : 'PLATFORM');

export type TypeRules = {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  timeZone: string;
  workingHours: unknown;
};

export type Availability =
  | { ok: true; source: 'CALENDAR' | 'MANUAL'; slots: Date[]; timeZone: string }
  | { ok: false; error: string };

export const AVAILABILITY_HORIZON_DAYS = 14;

function parseBlocked(value: unknown): Interval[] {
  if (!Array.isArray(value)) return [];
  const out: Interval[] = [];
  for (const v of value) {
    const start = new Date((v as { start?: string })?.start ?? '');
    const end = new Date((v as { end?: string })?.end ?? '');
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) out.push({ start, end });
  }
  return out;
}

/** Slots already held by meetings of this scope (the DB-side busy view; includes other types sharing the calendar). */
export async function lockedIntervals(scopeKey: string, range: Interval): Promise<Interval[]> {
  const rows = await prisma.meetingSlotLock.findMany({
    where: { resourceKey: scopeKey, startsAt: { lt: range.end }, endsAt: { gt: range.start } },
    select: { startsAt: true, endsAt: true },
  });
  return rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
}

/**
 * Free start times for a meeting type. Only busy intervals are used (no event titles or attendees are ever read);
 * `extraBusy` carries other participants' busy intervals so the result is the intersection of everyone's free time.
 * With no verified calendar, the manual availability rules apply; if the calendar lookup fails we return an
 * error rather than guessing.
 */
export async function computeAvailability(input: {
  scopeKey: string;
  rules: TypeRules;
  now?: Date;
  days?: number;
  extraBusy?: Interval[][];
  excludeMeetingId?: string;
  maxSlots?: number;
}): Promise<Availability> {
  const now = input.now ?? new Date();
  const days = input.days ?? AVAILABILITY_HORIZON_DAYS;
  const range: Interval = { start: now, end: new Date(now.getTime() + (days + 1) * 86_400_000) };
  const timeZone = isValidTimeZone(input.rules.timeZone) ? input.rules.timeZone : 'UTC';

  const conn = await getVerifiedConnection(input.scopeKey);
  const rule = await prisma.meetingAvailabilityRule.findUnique({ where: { resourceKey: input.scopeKey } });
  const busy: Interval[] = [...(input.extraBusy ?? []).flat(), ...parseBlocked(rule?.blocked)];

  let source: 'CALENDAR' | 'MANUAL' = 'MANUAL';
  let fallbackHours: WorkingHours | null = parseWorkingHours(rule?.workingHours);
  if (conn) {
    try {
      busy.push(...(await busyIntervals(conn, range)));
      source = 'CALENDAR';
      fallbackHours = fallbackHours ?? connectionRules(conn).workingHours;
    } catch {
      return { ok: false, error: 'The calendar could not be checked right now, so no times are offered.' };
    }
  }
  const locks = await lockedIntervals(input.scopeKey, range);
  busy.push(...locks);

  const workingHours = parseWorkingHours(input.rules.workingHours) ?? fallbackHours ?? DEFAULT_WORKING_HOURS;
  const slots = generateSlots({
    now,
    days,
    timeZone,
    workingHours,
    durationMin: input.rules.durationMin,
    stepMin: Math.max(15, Math.min(input.rules.durationMin, 30)),
    bufferBeforeMin: input.rules.bufferBeforeMin,
    bufferAfterMin: input.rules.bufferAfterMin,
    minNoticeMin: input.rules.minNoticeMin,
    busy: mergeIntervals(busy),
    maxSlots: input.maxSlots ?? 60,
  });
  return { ok: true, source, slots, timeZone };
}

export type SlotVerdict = 'OK' | 'TAKEN' | 'UNVERIFIABLE';

/** Fresh check run immediately before booking: live free/busy (when connected) plus held slots. */
export async function recheckSlot(input: {
  scopeKey: string;
  rules: Pick<TypeRules, 'bufferBeforeMin' | 'bufferAfterMin'>;
  start: Date;
  end: Date;
  excludeMeetingId?: string;
  extraBusy?: Interval[][];
}): Promise<SlotVerdict> {
  const pad = (input.rules.bufferBeforeMin + input.rules.bufferAfterMin + 1) * 60_000;
  const range = { start: new Date(input.start.getTime() - pad), end: new Date(input.end.getTime() + pad) };
  const busy: Interval[] = [...(input.extraBusy ?? []).flat()];
  const locks = await prisma.meetingSlotLock.findMany({
    where: { resourceKey: input.scopeKey, startsAt: { lt: range.end }, endsAt: { gt: range.start }, ...(input.excludeMeetingId ? { meetingId: { not: input.excludeMeetingId } } : {}) },
    select: { startsAt: true, endsAt: true },
  });
  busy.push(...locks.map((l) => ({ start: l.startsAt, end: l.endsAt })));
  const rule = await prisma.meetingAvailabilityRule.findUnique({ where: { resourceKey: input.scopeKey } });
  busy.push(...parseBlocked(rule?.blocked));
  const conn = await getVerifiedConnection(input.scopeKey);
  if (conn) {
    try {
      busy.push(...(await busyIntervals(conn, range)));
    } catch {
      return 'UNVERIFIABLE';
    }
  }
  return slotClashes({ start: input.start, end: input.end }, input.rules, busy) ? 'TAKEN' : 'OK';
}

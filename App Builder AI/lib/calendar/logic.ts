import { createHash } from 'node:crypto';

import { isValidTimeZone, zonedTimeToUtc } from '@/lib/ads/schedule';

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type WorkingHours = Partial<Record<DayKey, [string, string][]>>;
export type Interval = { start: Date; end: Date };

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: [['09:00', '17:00']],
  tue: [['09:00', '17:00']],
  wed: [['09:00', '17:00']],
  thu: [['09:00', '17:00']],
  fri: [['09:00', '17:00']],
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));

/** Strict parse of owner-supplied working hours; returns null when anything is malformed. */
export function parseWorkingHours(input: unknown): WorkingHours | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: WorkingHours = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(DAY_KEYS as readonly string[]).includes(key) || !Array.isArray(value) || value.length > 3) return null;
    const windows: [string, string][] = [];
    for (const w of value) {
      if (!Array.isArray(w) || w.length !== 2) return null;
      const [a, b] = w;
      if (typeof a !== 'string' || typeof b !== 'string' || !HHMM.test(a) || !HHMM.test(b) || toMin(a) >= toMin(b)) return null;
      windows.push([a, b]);
    }
    if (windows.length) out[key as DayKey] = windows;
  }
  return out;
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Sorted, merged busy intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else out.push({ start: cur.start, end: cur.end });
  }
  return out;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return { date: next.toISOString().slice(0, 10), day: DAY_KEYS[next.getUTCDay()] };
}

export type SlotRules = {
  now: Date;
  days: number;
  timeZone: string;
  workingHours: WorkingHours;
  durationMin: number;
  stepMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  busy: Interval[];
  maxSlots?: number;
};

/** Working windows as UTC intervals. Each edge is converted separately so DST days keep the correct real length. */
export function workingWindows(rules: Pick<SlotRules, 'now' | 'days' | 'timeZone' | 'workingHours'>): Interval[] {
  if (!isValidTimeZone(rules.timeZone)) return [];
  const today = localDate(rules.now, rules.timeZone);
  const out: Interval[] = [];
  for (let i = 0; i <= rules.days; i++) {
    const { date, day } = addDays(today, i);
    for (const [from, to] of rules.workingHours[day] ?? []) {
      const start = zonedTimeToUtc(`${date}T${from}`, rules.timeZone);
      const end = zonedTimeToUtc(`${date}T${to}`, rules.timeZone);
      if (start && end && end > start) out.push({ start, end });
    }
  }
  return out;
}

export function slotClashes(slot: Interval, rules: Pick<SlotRules, 'bufferBeforeMin' | 'bufferAfterMin'>, busy: Interval[]) {
  const padded = {
    start: new Date(slot.start.getTime() - rules.bufferBeforeMin * 60_000),
    end: new Date(slot.end.getTime() + rules.bufferAfterMin * 60_000),
  };
  return busy.some((b) => overlaps(padded, b));
}

/** Free slot start times: inside working hours, after the minimum notice, not touching busy time (buffers applied). */
export function generateSlots(rules: SlotRules): Date[] {
  const earliest = rules.now.getTime() + rules.minNoticeMin * 60_000;
  const busy = mergeIntervals(rules.busy);
  const out: Date[] = [];
  for (const w of workingWindows(rules)) {
    for (let t = w.start.getTime(); t + rules.durationMin * 60_000 <= w.end.getTime(); t += rules.stepMin * 60_000) {
      if (t < earliest) continue;
      const slot = { start: new Date(t), end: new Date(t + rules.durationMin * 60_000) };
      if (!slotClashes(slot, rules, busy)) out.push(slot.start);
      if (out.length >= (rules.maxSlots ?? 200)) return out;
    }
  }
  return out;
}

/** Whether one specific start is bookable under the same rules (used immediately before confirming). */
export function isStartBookable(start: Date, rules: SlotRules) {
  const end = new Date(start.getTime() + rules.durationMin * 60_000);
  if (start.getTime() < rules.now.getTime() + rules.minNoticeMin * 60_000) return false;
  const inWindow = workingWindows({ ...rules, days: rules.days + 1 }).some((w) => w.start <= start && end <= w.end);
  return inWindow && !slotClashes({ start, end }, rules, mergeIntervals(rules.busy));
}

/** Deterministic provider event id: Google accepts [a-v0-9]{5,1024}; reused as the Graph transactionId. */
export const eventIdFor = (key: string) => `ab${createHash('sha256').update(`aw-cal:${key}`).digest('hex').slice(0, 40)}`;

export const SLOT_PREFIX = 'cal:';

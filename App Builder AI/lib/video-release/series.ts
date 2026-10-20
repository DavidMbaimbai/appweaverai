import { isValidTimeZone, zonedTimeToUtc } from '@/lib/ads/schedule';

export const MAX_SERIES_EPISODES = 100;
const MAX_SCAN_DAYS = 800;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type SeriesPattern =
  | { type: 'daily'; time: string }
  /** weekdays: 0 = Sunday ... 6 = Saturday. */
  | { type: 'weekly'; weekdays: number[]; time: string }
  | { type: 'interval'; everyDays: number; time: string }
  /** Explicit local wall-clock times, "YYYY-MM-DDTHH:mm". */
  | { type: 'explicit'; localTimes: string[] };

export type SeriesInput = {
  pattern: SeriesPattern;
  timeZone: string;
  /** Local calendar date of the first possible slot, "YYYY-MM-DD" (ignored for explicit). */
  startDate: string;
  count: number;
  season?: number;
  firstEpisode?: number;
  now?: Date;
};

export type SeriesSlot = {
  index: number;
  season: number;
  episode: number;
  localTime: string;
  scheduledAt: Date;
};

export type SeriesResult = { ok: true; slots: SeriesSlot[] } | { ok: false; error: string };

const pad = (n: number) => String(n).padStart(2, '0');

function localDate(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseDate(value: string): number | null {
  const m = value.match(DATE);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDate(ms) === value ? ms : null;
}

/** Local wall-clock times of the series, before conversion to UTC. */
function localTimes(input: SeriesInput): string[] | string {
  const { pattern, startDate, count } = input;
  if (pattern.type === 'explicit') {
    return [...pattern.localTimes].sort();
  }
  if (!TIME.test(pattern.time)) return 'Time must be HH:MM (24h).';
  const start = parseDate(startDate);
  if (start === null) return 'Start date must be YYYY-MM-DD.';
  const out: string[] = [];
  const DAY = 86_400_000;
  if (pattern.type === 'daily') {
    for (let i = 0; i < count; i++) out.push(`${localDate(start + i * DAY)}T${pattern.time}`);
  } else if (pattern.type === 'interval') {
    if (!Number.isInteger(pattern.everyDays) || pattern.everyDays < 1 || pattern.everyDays > 365) {
      return 'Interval must be 1-365 days.';
    }
    for (let i = 0; i < count; i++) out.push(`${localDate(start + i * pattern.everyDays * DAY)}T${pattern.time}`);
  } else {
    const days = new Set(pattern.weekdays);
    if (days.size === 0 || [...days].some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return 'Choose at least one weekday.';
    }
    for (let i = 0; i < MAX_SCAN_DAYS && out.length < count; i++) {
      const ms = start + i * DAY;
      if (days.has(new Date(ms).getUTCDay())) out.push(`${localDate(ms)}T${pattern.time}`);
    }
  }
  return out;
}

/**
 * Pure series generator: episode n is always scheduled strictly before
 * episode n + 1, and every slot is a distinct future UTC instant.
 */
export function generateSeries(input: SeriesInput): SeriesResult {
  const { count, timeZone } = input;
  const now = input.now ?? new Date();
  if (!isValidTimeZone(timeZone)) return { ok: false, error: 'Unknown time zone.' };
  if (input.pattern.type !== 'explicit' && (!Number.isInteger(count) || count < 1 || count > MAX_SERIES_EPISODES)) {
    return { ok: false, error: `Choose 1-${MAX_SERIES_EPISODES} episodes.` };
  }
  const locals = localTimes(input);
  if (typeof locals === 'string') return { ok: false, error: locals };
  if (locals.length === 0 || locals.length > MAX_SERIES_EPISODES) {
    return { ok: false, error: `Choose 1-${MAX_SERIES_EPISODES} release times.` };
  }

  const season = input.season ?? 1;
  const first = input.firstEpisode ?? 1;
  const slots: SeriesSlot[] = [];
  for (const [index, local] of locals.entries()) {
    const scheduledAt = zonedTimeToUtc(local, timeZone);
    if (!scheduledAt) return { ok: false, error: `"${local}" is not a valid date and time.` };
    const previous = slots[slots.length - 1];
    if (previous && scheduledAt.getTime() <= previous.scheduledAt.getTime()) {
      return { ok: false, error: 'Release times must be distinct and in order.' };
    }
    slots.push({ index, season, episode: first + index, localTime: local, scheduledAt });
  }
  if (slots[0].scheduledAt.getTime() <= now.getTime()) {
    return { ok: false, error: 'The first release is not in the future. Pick a later start.' };
  }
  return { ok: true, slots };
}

export type SequencedRelease = {
  id: string;
  status: string;
  seriesKey: string | null;
  platform: string;
  language: string;
  season: number | null;
  episode: number | null;
};

const DONE = new Set(['PUBLISHED', 'CANCELLED']);

/**
 * Rejects a reschedule that would put episode n at or after episode n + 1 (or
 * n + 1 at or before n) of the same series, platform and language.
 */
export function sequenceOrderError<T extends SequencedRelease & { scheduledAt: Date }>(
  release: T,
  newTime: Date,
  all: T[],
): string | null {
  if (!release.seriesKey || release.episode === null) return null;
  const order = (r: SequencedRelease) => (r.season ?? 0) * 100_000 + (r.episode ?? 0);
  const mine = order(release);
  for (const other of all) {
    if (
      other.id === release.id ||
      other.seriesKey !== release.seriesKey ||
      other.platform !== release.platform ||
      other.language !== release.language ||
      other.episode === null ||
      other.status === 'CANCELLED'
    ) {
      continue;
    }
    const theirs = order(other);
    if (theirs < mine && other.scheduledAt.getTime() >= newTime.getTime()) {
      return `Episode ${other.episode} must be released before episode ${release.episode}.`;
    }
    if (theirs > mine && other.scheduledAt.getTime() <= newTime.getTime()) {
      return `Episode ${other.episode} must be released after episode ${release.episode}.`;
    }
  }
  return null;
}

/**
 * Episode n + 1 must wait for n of the same series, platform and language.
 * Anything not PUBLISHED or CANCELLED (failed, paused, manual, draft...)
 * blocks the later episodes, so order can never be broken silently.
 */
export function blockingPredecessor<T extends SequencedRelease>(release: T, all: T[]): T | null {
  if (!release.seriesKey || release.episode === null) return null;
  const order = (r: SequencedRelease) => (r.season ?? 0) * 100_000 + (r.episode ?? 0);
  const mine = order(release);
  return (
    all.find(
      (r) =>
        r.id !== release.id &&
        r.seriesKey === release.seriesKey &&
        r.platform === release.platform &&
        r.language === release.language &&
        r.episode !== null &&
        order(r) < mine &&
        !DONE.has(r.status),
    ) ?? null
  );
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a wall-clock time ("2026-11-02T09:30") in an IANA time zone
 * to the UTC instant. Returns null for invalid input.
 */
export function zonedTimeToUtc(local: string, timeZone: string): Date | null {
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Second pass handles zones whose offset differs at the corrected instant (DST).
  const second = guess - offsetMs(new Date(first), timeZone);
  const result = new Date(second);
  return Number.isNaN(result.getTime()) ? null : result;
}

export const MAX_SCHEDULE_AHEAD_DAYS = 30;

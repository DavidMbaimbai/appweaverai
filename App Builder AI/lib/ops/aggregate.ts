export type OpsEnvironment = 'PRODUCTION' | 'STAGING';

export type OpsDeploymentPoint = {
  status: string;
  environment: OpsEnvironment;
  createdAt: Date | string;
};

export type StatusGroup = 'success' | 'failed' | 'running';

const RUNNING = new Set(['PENDING', 'PROVISIONING', 'BUILDING', 'BUNDLING', 'PROMOTING']);

/** SUPERSEDED rows were live before a newer deploy replaced them, so they count as successful. */
export function statusGroup(status: string): StatusGroup {
  if (status === 'FAILED') return 'failed';
  if (RUNNING.has(status)) return 'running';
  return 'success';
}

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar day (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function dayKey(value: Date | string, timeZone = 'UTC') {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(toDate(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(key: string, delta: number) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** The last `days` calendar keys ending at `now`'s day, oldest first. */
export function lastDayKeys(days: number, now: Date, timeZone = 'UTC') {
  const today = dayKey(now, timeZone);
  return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
}

export type DayBucket = {
  day: string;
  success: number;
  failed: number;
  running: number;
  total: number;
};

/** Deployments per day, zero-filled, split by status group. Items outside the window are ignored. */
export function bucketByDay(
  items: OpsDeploymentPoint[],
  days: number,
  now: Date,
  timeZone = 'UTC',
): DayBucket[] {
  const buckets = new Map<string, DayBucket>(
    lastDayKeys(days, now, timeZone).map((day) => [
      day,
      { day, success: 0, failed: 0, running: 0, total: 0 },
    ]),
  );
  for (const item of items) {
    const bucket = buckets.get(dayKey(item.createdAt, timeZone));
    if (!bucket) continue;
    bucket[statusGroup(item.status)] += 1;
    bucket.total += 1;
  }
  return [...buckets.values()];
}

/** Percent of finished deployments (success + failed) that succeeded; null when none finished. */
export function successRate(items: { status: string }[]) {
  let success = 0;
  let failed = 0;
  for (const item of items) {
    const group = statusGroup(item.status);
    if (group === 'success') success += 1;
    else if (group === 'failed') failed += 1;
  }
  const finished = success + failed;
  return finished === 0 ? null : Math.round((success / finished) * 1000) / 10;
}

export function statusDistribution(items: { status: string }[]) {
  const counts = { success: 0, failed: 0, running: 0 };
  for (const item of items) counts[statusGroup(item.status)] += 1;
  return counts;
}

export function inRange(
  items: OpsDeploymentPoint[],
  days: number,
  now: Date,
  timeZone = 'UTC',
) {
  const keys = new Set(lastDayKeys(days, now, timeZone));
  return items.filter((item) => keys.has(dayKey(item.createdAt, timeZone)));
}

export function kpis(items: OpsDeploymentPoint[]) {
  const dist = statusDistribution(items);
  return {
    total: items.length,
    successful: dist.success,
    failed: dist.failed,
    running: dist.running,
    successRate: successRate(items),
  };
}

export function successRateByEnvironment(items: OpsDeploymentPoint[]) {
  const rows = {} as Record<OpsEnvironment, { total: number; rate: number | null }>;
  for (const env of ['PRODUCTION', 'STAGING'] as const) {
    const subset = items.filter((i) => i.environment === env);
    rows[env] = { total: subset.length, rate: successRate(subset) };
  }
  return rows;
}

export type WeekBucket = { weekStart: string; total: number; success: number; failed: number };

/** Rolling 7-day windows ending today (oldest first), so the last bar always matches "last 7 days". */
export function weeklyTrend(
  items: OpsDeploymentPoint[],
  weeks: number,
  now: Date,
  timeZone = 'UTC',
): WeekBucket[] {
  const keys = lastDayKeys(weeks * 7, now, timeZone);
  const result: WeekBucket[] = Array.from({ length: weeks }, (_, w) => ({
    weekStart: keys[w * 7],
    total: 0,
    success: 0,
    failed: 0,
  }));
  const index = new Map(keys.map((key, i) => [key, Math.floor(i / 7)]));
  for (const item of items) {
    const w = index.get(dayKey(item.createdAt, timeZone));
    if (w === undefined) continue;
    result[w].total += 1;
    const group = statusGroup(item.status);
    if (group === 'success') result[w].success += 1;
    else if (group === 'failed') result[w].failed += 1;
  }
  return result;
}

/** Wall-clock time from creation to the last known state change; null while unfinished or invalid. */
export function deploymentDurationMs(d: {
  status: string;
  createdAt: Date | string;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
}) {
  if (statusGroup(d.status) === 'running') return null;
  const end = d.status === 'FAILED' ? d.updatedAt : (d.publishedAt ?? d.updatedAt);
  const ms = toDate(end).getTime() - toDate(d.createdAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function formatDuration(ms: number | null) {
  if (ms === null) return '—';
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

import { isSafeAdText } from '@/lib/social/adverts';
import { MAX_SCHEDULE_AHEAD_DAYS, zonedTimeToUtc } from '@/lib/ads/schedule';

import {
  AUTO_PUBLISH_PLATFORMS,
  composePostText,
  MAX_TEXT,
  PLATFORM_LABELS,
  PLATFORMS,
  type Platform,
} from './constants';
import { hasInstagramImage } from './instagram';

export { AUTO_PUBLISH_PLATFORMS, composePostText, MAX_TEXT, PLATFORM_LABELS, PLATFORMS };
export type { Platform };

/** A post that is overdue by more than this is not published any more. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

export function isAutoPublishPlatform(platform: Platform) {
  return AUTO_PUBLISH_PLATFORMS.includes(platform);
}

export function normalizeHashtags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input.map(String)
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = item.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag && tag.length <= 40) seen.add(tag);
  }
  return [...seen].slice(0, 10);
}

export function validatePostText(platform: Platform, text: string, hashtags: string[]): string | null {
  const body = text.trim();
  if (!body) return 'Post text is empty.';
  if (composePostText(body, hashtags).length > MAX_TEXT[platform]) {
    return `${PLATFORM_LABELS[platform]} posts are limited to ${MAX_TEXT[platform]} characters including hashtags.`;
  }
  if (!isSafeAdText(body)) return 'This text contains claims that are not allowed. Please rewrite it.';
  return null;
}

export type GeneratedPost = {
  platform: Platform;
  text: string;
  hashtags: string[];
  dayOffset: number;
  time: string;
};

/** Parses the model output; invalid posts are dropped, one valid post is enough. */
export function parseCampaign(raw: string): { name: string; posts: GeneratedPost[] } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: { name?: unknown; posts?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.posts)) return null;

  const posts: GeneratedPost[] = [];
  for (const item of parsed.posts) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const platform = typeof entry.platform === 'string' ? entry.platform.toUpperCase() : '';
    if (!isPlatform(platform)) continue;
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    const hashtags = normalizeHashtags(entry.hashtags);
    if (validatePostText(platform, text, hashtags)) continue;
    const dayOffset = Number(entry.dayOffset);
    const time = typeof entry.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time) ? entry.time : '10:00';
    posts.push({
      platform,
      text,
      hashtags,
      dayOffset: Number.isInteger(dayOffset) ? Math.min(Math.max(dayOffset, 1), MAX_SCHEDULE_AHEAD_DAYS - 1) : 1,
      time,
    });
  }
  if (!posts.length) return null;
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 80) : 'Campaign';
  return { name, posts };
}

function localDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts; // YYYY-MM-DD
}

/** Suggested slot: `dayOffset` days after today (in the zone) at `time` local, as UTC. */
export function suggestedSlot(now: Date, dayOffset: number, time: string, timeZone: string): Date | null {
  const [y, m, d] = localDate(now, timeZone).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + dayOffset));
  const iso = `${day.toISOString().slice(0, 10)}T${time}`;
  return zonedTimeToUtc(iso, timeZone);
}

/** Owner-chosen wall-clock time -> UTC, rejecting past or too-distant times. */
export function resolveSchedule(
  local: string,
  timeZone: string,
  now = new Date(),
): { ok: true; at: Date } | { ok: false; error: string } {
  const at = zonedTimeToUtc(local, timeZone);
  if (!at) return { ok: false, error: 'Invalid date or time zone.' };
  if (at.getTime() <= now.getTime() + 60_000) return { ok: false, error: 'Choose a time in the future.' };
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) {
    return { ok: false, error: `Schedule at most ${MAX_SCHEDULE_AHEAD_DAYS} days ahead.` };
  }
  return { ok: true, at };
}

type Schedulable = { id: string; status: string; scheduledAt: Date | null };

/** Only explicitly approved posts whose time has come; long-overdue ones are reported separately. */
export function selectDuePosts<T extends Schedulable>(posts: T[], now = new Date()) {
  const due: T[] = [];
  const stale: T[] = [];
  for (const post of posts) {
    if (post.status !== 'APPROVED' && post.status !== 'SCHEDULED') continue;
    if (!post.scheduledAt || post.scheduledAt.getTime() > now.getTime()) continue;
    (now.getTime() - post.scheduledAt.getTime() > STALE_AFTER_MS ? stale : due).push(post);
  }
  due.sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime());
  return { due, stale };
}

/** Status after the owner approves: no API, no connection, or (Instagram) no image means manual posting. */
export function approvedStatus(platform: Platform, connected: boolean, imageUrl?: string | null) {
  if (platform === 'INSTAGRAM' && !hasInstagramImage(imageUrl)) return 'MANUAL' as const;
  return isAutoPublishPlatform(platform) && connected ? ('SCHEDULED' as const) : ('MANUAL' as const);
}

/** Groups posts by calendar day in their own time zone; unscheduled drafts last. */
export function groupByDate<T extends { scheduledAt: Date | null; timeZone: string }>(posts: T[]) {
  const groups = new Map<string, T[]>();
  const sorted = [...posts].sort(
    (a, b) => (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity),
  );
  for (const post of sorted) {
    const key = post.scheduledAt ? localDate(post.scheduledAt, post.timeZone) : 'Unscheduled';
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  return [...groups.entries()].map(([date, items]) => ({ date, items }));
}

export function countBy<T>(items: T[], key: (item: T) => string) {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

export function campaignStatus(statuses: string[]): 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' {
  if (statuses.some((s) => ['APPROVED', 'SCHEDULED', 'PUBLISHING'].includes(s))) return 'SCHEDULED';
  if (statuses.some((s) => s === 'PUBLISHED') && statuses.every((s) => s === 'PUBLISHED' || s === 'MANUAL')) {
    return 'PUBLISHED';
  }
  return 'DRAFT';
}

/** Value for an <input type="datetime-local"> showing `at` in `timeZone`. */
export function toLocalInput(at: Date | null, timeZone: string) {
  if (!at) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .replace(' ', 'T');
}

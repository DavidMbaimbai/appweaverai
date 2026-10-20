import { zonedTimeToUtc } from '@/lib/ads/schedule';

import type { ReleasePlatform } from './capabilities';

export const MIN_HISTORY_SAMPLES = 5;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type HistoryItem = {
  platform: string;
  publishedAt: Date;
  /** Platform-returned view count; null when the platform did not report one. */
  views: number | null;
};

export type TimeWindow = { weekday: number; hour: number; label: string; averageViews?: number; samples?: number };

export type Recommendation = {
  platform: ReleasePlatform;
  basis: 'own-history' | 'general';
  basisLabel: string;
  explanation: string;
  windows: TimeWindow[];
};

const win = (weekday: number, hour: number): TimeWindow => ({
  weekday,
  hour,
  label: `${WEEKDAYS[weekday]} ${String(hour).padStart(2, '0')}:00`,
});

/**
 * General best-practice windows (local audience time). These are widely
 * repeated rules of thumb for when audiences are online, NOT measurements
 * from this account, and are always shown as such.
 */
const GENERAL: Record<ReleasePlatform, TimeWindow[]> = {
  YOUTUBE: [win(4, 17), win(5, 15), win(6, 10)],
  FACEBOOK: [win(2, 9), win(3, 12), win(4, 9)],
  INSTAGRAM: [win(2, 11), win(3, 19), win(5, 12)],
  LINKEDIN: [win(2, 9), win(3, 10), win(4, 8)],
  X: [win(1, 9), win(3, 12), win(4, 17)],
  TIKTOK: [win(2, 19), win(4, 19), win(0, 20)],
};

export function localSlot(date: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit' }).formatToParts(date);
  const day = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return { weekday: Math.max(SHORT.indexOf(day), 0), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) };
}

/** Ranks the owner's own weekday/hour slots by average platform-reported views; otherwise labelled general windows. */
export function recommendTimes(platform: ReleasePlatform, history: HistoryItem[], timeZone: string): Recommendation {
  const measured = history.filter((h) => h.platform === platform && h.views !== null);
  if (measured.length >= MIN_HISTORY_SAMPLES) {
    const slots = new Map<string, { weekday: number; hour: number; total: number; n: number }>();
    for (const item of measured) {
      const { weekday, hour } = localSlot(item.publishedAt, timeZone);
      const key = `${weekday}-${hour}`;
      const slot = slots.get(key) ?? { weekday, hour, total: 0, n: 0 };
      slot.total += item.views ?? 0;
      slot.n += 1;
      slots.set(key, slot);
    }
    if (slots.size >= 2) {
      const windows = [...slots.values()]
        .map((s) => ({ ...win(s.weekday, s.hour), averageViews: Math.round(s.total / s.n), samples: s.n }))
        .sort((a, b) => b.averageViews - a.averageViews)
        .slice(0, 3);
      return {
        platform,
        basis: 'own-history',
        basisLabel: `Based on your ${measured.length} published videos with measured views`,
        explanation:
          'Ranked by the average views the platform reported for videos you released in each weekday/hour slot. Small samples are noisy; treat this as a hint, not a guarantee.',
        windows,
      };
    }
  }
  return {
    platform,
    basis: 'general',
    basisLabel: 'General best-practice windows, not based on your data',
    explanation:
      measured.length === 0
        ? 'You have no published videos with measured views on this platform yet, so these are commonly cited audience-activity windows. They are not analytics from your account.'
        : `You have ${measured.length} measured video${measured.length === 1 ? '' : 's'} on this platform; at least ${MIN_HISTORY_SAMPLES} spread over different time slots are needed for a personal recommendation. These are general windows, not analytics from your account.`,
    windows: GENERAL[platform],
  };
}

/** The next concrete UTC instants for the recommended windows after `now`. */
export function upcomingSlots(windows: TimeWindow[], timeZone: string, now = new Date(), limit = 3): Date[] {
  const out: Date[] = [];
  for (let offset = 0; offset < 14; offset++) {
    const probe = new Date(now.getTime() + offset * 86_400_000);
    const { weekday } = localSlot(probe, timeZone);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(probe);
    for (const w of windows.filter((x) => x.weekday === weekday)) {
      const at = zonedTimeToUtc(`${day}T${String(w.hour).padStart(2, '0')}:00`, timeZone);
      if (at && at.getTime() > now.getTime() + 15 * 60_000) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, limit);
}

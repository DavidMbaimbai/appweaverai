import { isValidEmail, normalizeEmail } from '@/lib/outreach/compliance';
import { isValidTimeZone } from '@/lib/ads/schedule';

import { localHour } from './sms';

export const MAX_DAILY_LIMIT = 50;
export const DEFAULT_DAILY_LIMIT = 20;
export const MAX_FOLLOW_UPS_CAP = 2;
export const BOUNCE_PAUSE_RATE = 0.05;

/** Personal webmail is not a "publicly listed professional business email". */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk', 'outlook.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'gmx.de', 'mail.com', 'yandex.com', 'zoho.com', 'qq.com',
]);

export type CampaignSettings = {
  dailyLimit: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  timezone: string;
  maxFollowUps: number;
  followUpDays: number[];
};

/** Clamps owner input to the hard limits; invalid time zones are rejected rather than guessed. */
export function normalizeSettings(input: Partial<CampaignSettings>): { ok: true; value: CampaignSettings } | { ok: false; error: string } {
  const timezone = (input.timezone ?? 'UTC').trim();
  if (!isValidTimeZone(timezone)) return { ok: false, error: 'Unknown time zone.' };
  const start = Math.trunc(input.sendWindowStart ?? 9);
  const end = Math.trunc(input.sendWindowEnd ?? 17);
  if (start < 0 || end > 24 || start >= end) return { ok: false, error: 'The send window must start before it ends (hours 0-24).' };
  const maxFollowUps = Math.min(MAX_FOLLOW_UPS_CAP, Math.max(0, Math.trunc(input.maxFollowUps ?? MAX_FOLLOW_UPS_CAP)));
  const days = (input.followUpDays ?? [4, 7]).map((d) => Math.trunc(d)).filter((d) => d >= 2 && d <= 30);
  const followUpDays = days.slice(0, maxFollowUps);
  const dailyLimit = Math.min(MAX_DAILY_LIMIT, Math.max(1, Math.trunc(input.dailyLimit ?? DEFAULT_DAILY_LIMIT)));
  return { ok: true, value: { dailyLimit, sendWindowStart: start, sendWindowEnd: end, timezone, maxFollowUps: followUpDays.length, followUpDays } };
}

/** Weekdays only, inside [start, end) in the campaign time zone. Unknown zones are never inside. */
export function insideCampaignWindow(now: Date, timezone: string, start: number, end: number): boolean {
  if (!isValidTimeZone(timezone)) return false;
  const hour = localHour(now, timezone);
  if (hour === null || hour < start || hour >= end) return false;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

export function emailDomain(email: string) {
  return normalizeEmail(email).split('@')[1] ?? '';
}

export type TargetCandidate = {
  email: string | null | undefined;
  sourceUrl: string | null | undefined;
  optedOut: boolean;
  suppressed: boolean;
};

/** Why an investor may not be a campaign target (null = eligible). */
export function targetBlockReason(c: TargetCandidate): string | null {
  const email = c.email?.trim();
  if (!email || !isValidEmail(email)) return 'No valid email address.';
  if (FREE_MAIL.has(emailDomain(email))) return 'Personal webmail address; only publicly listed business emails are allowed.';
  if (!c.sourceUrl || !/^https:\/\//i.test(c.sourceUrl)) return 'No public source URL recorded for this email.';
  if (c.optedOut) return 'This contact has opted out.';
  if (c.suppressed) return 'This address is on the suppression list.';
  return null;
}

export const PLACEHOLDERS = ['name', 'firstName', 'firm', 'company'] as const;

export type MergeVars = Partial<Record<(typeof PLACEHOLDERS)[number], string | null | undefined>>;

/** Returns null when a placeholder is unknown or has no real value: we never send "Hi ,". */
export function renderTemplate(template: string, vars: MergeVars): string | null {
  let missing = false;
  const out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const value = (PLACEHOLDERS as readonly string[]).includes(key) ? vars[key as keyof MergeVars]?.trim() : '';
    if (!value) missing = true;
    return value ?? '';
  });
  return missing || out.includes('{{') ? null : out;
}

export function unknownPlaceholders(template: string): string[] {
  const found = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k)))];
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Stable variant choice so the previewed email is exactly the one that gets sent. */
export function pickVariantIndex(seed: string, count: number) {
  if (count <= 1) return 0;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % count;
}

export const DEFAULT_FOLLOW_UP =
  'Hi {{firstName}},\n\nJust following up on my earlier note about {{company}}. If it is relevant to {{firm}}, I would be glad to share more; if not, no problem at all.\n\nBest regards,';

export type TargetGateInput = {
  campaignStatus: string;
  targetStatus: string;
  optedOut: boolean;
  sequenceActive: boolean;
  suppressed: boolean;
  replied: boolean;
  alreadySentStep: boolean;
  step: number;
  maxFollowUps: number;
};

/** Final pre-send gate, evaluated against freshly read state for every single message. */
export function campaignSendBlock(g: TargetGateInput): { reason: string; stop: string | null } | null {
  if (g.campaignStatus !== 'RUNNING') return { reason: 'Campaign is not running.', stop: null };
  if (g.targetStatus !== 'ACTIVE') return { reason: 'Target is no longer active.', stop: null };
  if (g.alreadySentStep) return { reason: 'This step was already sent.', stop: null };
  if (g.optedOut || g.suppressed) return { reason: 'Opted out or suppressed.', stop: 'STOPPED_OPTOUT' };
  if (g.replied) return { reason: 'Contact replied.', stop: 'STOPPED_REPLY' };
  if (!g.sequenceActive) return { reason: 'Sequence stopped for this investor.', stop: 'STOPPED_MANUAL' };
  if (g.step > g.maxFollowUps) return { reason: 'Sequence complete.', stop: 'COMPLETED' };
  return null;
}

/** Pause when bounces suggest a bad list: >5% once there is a meaningful sample. */
export function shouldPauseForBounces(sent: number, bounced: number) {
  if (sent <= 0 || bounced <= 0) return false;
  const rate = bounced / sent;
  if (rate <= BOUNCE_PAUSE_RATE) return false;
  return sent >= 10 || bounced >= 2;
}

/** Days until the next step, or null when the sequence has no further step. */
export function nextStepDelayDays(stepsSent: number, followUpDays: number[], maxFollowUps: number): number | null {
  if (stepsSent < 1 || stepsSent > maxFollowUps) return null;
  return followUpDays[stepsSent - 1] ?? null;
}

const BOUNCE_SENDER = /(mailer-daemon|postmaster)@/i;
export function isBounceSender(address: string | undefined | null) {
  return Boolean(address && BOUNCE_SENDER.test(address));
}

export function extractEmails(text: string): string[] {
  const found = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map(normalizeEmail))];
}

/** Replies that need a person (never answered automatically). */
export function needsHumanReply(label: string) {
  return !['unsubscribe', 'not_interested', 'wrong_contact'].includes(label);
}

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

import { isValidTimeZone } from '@/lib/ads/schedule';
import { mergeIntervals, type Interval } from '@/lib/calendar/logic';

export const MEETING_STATUSES = [
  'REQUESTED',
  'PROPOSED',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
  'MISSED',
  'FAILED',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_CATEGORIES = ['USER', 'INVESTOR', 'CUSTOMER', 'BUSINESS', 'INTERNAL'] as const;
export type MeetingCategory = (typeof MEETING_CATEGORIES)[number];

export const LOCATION_KINDS = ['GOOGLE_MEET', 'TEAMS', 'ZOOM', 'PHONE', 'IN_PERSON', 'MANUAL_LINK'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const SOURCE_TYPES = ['LEAD', 'INVESTOR', 'SUPPORT_TICKET', 'PROJECT', 'USER_REQUEST', 'MANUAL'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** A meeting that holds a calendar slot. */
export const ACTIVE_STATUSES: MeetingStatus[] = ['CONFIRMED', 'RESCHEDULED'];
export const OPEN_STATUSES: MeetingStatus[] = ['REQUESTED', 'PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'RESCHEDULED'];

const TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  REQUESTED: ['PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'FAILED'],
  PROPOSED: ['AWAITING_CONFIRMATION', 'CONFIRMED', 'REQUESTED', 'CANCELLED', 'FAILED'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'PROPOSED', 'REQUESTED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['RESCHEDULED', 'PROPOSED', 'CANCELLED', 'COMPLETED', 'MISSED', 'FAILED'],
  RESCHEDULED: ['RESCHEDULED', 'PROPOSED', 'CANCELLED', 'COMPLETED', 'MISSED', 'FAILED'],
  CANCELLED: [],
  COMPLETED: [],
  MISSED: ['REQUESTED'],
  FAILED: ['REQUESTED', 'CANCELLED'],
};

export const canTransition = (from: MeetingStatus, to: MeetingStatus) => TRANSITIONS[from]?.includes(to) ?? false;

export type Participant = {
  name: string;
  email?: string | null;
  phone?: string | null;
  timeZone?: string | null;
  role?: 'HOST' | 'REQUIRED' | 'OPTIONAL';
  userId?: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseParticipants(input: unknown): Participant[] {
  if (!Array.isArray(input)) return [];
  const out: Participant[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const name = String(p.name ?? '').trim().slice(0, 120);
    const email = typeof p.email === 'string' && EMAIL.test(p.email.trim()) ? p.email.trim().toLowerCase().slice(0, 254) : null;
    if (!name && !email) continue;
    const tz = typeof p.timeZone === 'string' && isValidTimeZone(p.timeZone) ? p.timeZone : null;
    out.push({
      name: name || (email as string),
      email,
      phone: typeof p.phone === 'string' ? p.phone.trim().slice(0, 40) || null : null,
      timeZone: tz,
      role: p.role === 'HOST' || p.role === 'OPTIONAL' ? p.role : 'REQUIRED',
      userId: typeof p.userId === 'string' ? p.userId : null,
    });
  }
  return out.slice(0, 20);
}

/** Free time shared by every participant, using busy intervals only (no event details ever reach this layer). */
export function commonFree(window: Interval, busyPerParticipant: Interval[][]): Interval[] {
  const busy = mergeIntervals(busyPerParticipant.flat());
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

export const idempotencyKeyFor = (parts: (string | number | null | undefined)[]) =>
  createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 48);

// ---- Signed participant links -------------------------------------------------------------------------------

export type LinkAction = 'manage';
export type LinkClaims = { m: string; v: number; e: string; exp: number };

const linkSecret = () => {
  const s = process.env.MEETING_LINK_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error('MEETING_LINK_SECRET (or BETTER_AUTH_SECRET) is not set.');
  return s;
};

const b64 = (s: string) => Buffer.from(s).toString('base64url');

/** Token = base64url(claims).hmac. The participant email is bound in so one invitee cannot act as another. */
export function signMeetingToken(meetingId: string, tokenVersion: number, email: string, expiresAt: Date): string {
  const body = b64(JSON.stringify({ m: meetingId, v: tokenVersion, e: email.toLowerCase(), exp: expiresAt.getTime() } satisfies LinkClaims));
  const mac = createHmac('sha256', linkSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyMeetingToken(token: string, now = new Date()): LinkClaims | null {
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  let expected: string;
  try {
    expected = createHmac('sha256', linkSecret()).update(body).digest('base64url');
  } catch {
    return null;
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkClaims;
    if (typeof claims.m !== 'string' || typeof claims.v !== 'number' || typeof claims.e !== 'string' || claims.exp < now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---- Rendering ----------------------------------------------------------------------------------------------

export function formatInZone(instant: Date, timeZone: string) {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(instant)} (${tz})`;
}

export type InviteView = {
  title: string;
  startsAt: Date;
  durationMin: number;
  timeZone: string;
  participants: Participant[];
  agenda: string;
  link: string | null;
  location: string | null;
  manageUrl: string;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Participants see names only (never emails/phones of others) and never internal notes. */
export function renderInvite(view: InviteView, heading: string): { subject: string; text: string; html: string } {
  const when = formatInZone(view.startsAt, view.timeZone);
  const who = view.participants.map((p) => p.name).join(', ');
  const where = view.link ? `Join: ${view.link}` : view.location ? `Location: ${view.location}` : 'Joining details: the organiser will send these separately.';
  const lines = [
    heading,
    '',
    `Meeting: ${view.title}`,
    `When: ${when}`,
    `Duration: ${view.durationMin} minutes`,
    `Participants: ${who}`,
    view.agenda ? `Agenda: ${view.agenda}` : '',
    where,
    '',
    `Need to change plans? Reschedule or cancel here: ${view.manageUrl}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  const html = `<p><strong>${esc(heading)}</strong></p><ul><li>Meeting: ${esc(view.title)}</li><li>When: ${esc(when)}</li><li>Duration: ${view.durationMin} minutes</li><li>Participants: ${esc(who)}</li>${view.agenda ? `<li>Agenda: ${esc(view.agenda)}</li>` : ''}<li>${view.link ? `Join: <a href="${esc(view.link)}">${esc(view.link)}</a>` : esc(where)}</li></ul><p>Need to change plans? <a href="${esc(view.manageUrl)}">Reschedule or cancel</a>.</p>`;
  return { subject: `${heading}: ${view.title}`, text: lines.join('\n'), html };
}

export const isHttpsUrl = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

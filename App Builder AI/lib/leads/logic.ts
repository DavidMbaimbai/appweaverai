import { z } from 'zod';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_BOOKED', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const isLeadStatus = (v: unknown): v is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(v as string);

export const CONSENT_TEXT = 'I agree to be contacted by email about my enquiry.';

export const normalizeEmail = (email: string | null | undefined) => {
  const v = email?.trim().toLowerCase();
  return v || null;
};

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v);

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const UTM_KEYS = ['source', 'medium', 'campaign', 'content'] as const;
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/** Keeps only the four known UTM keys with safe short values. */
export function cleanUtm(raw: unknown): Utm | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Utm = {};
  for (const key of UTM_KEYS) {
    const v = clip((raw as Record<string, unknown>)[key], 80);
    if (v && /^[\w.\-~ ]+$/.test(v)) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

export const publicLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).refine(isEmail, 'Invalid email'),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(2000).optional(),
  consent: z.boolean().optional(),
  utm: z.unknown().optional(),
  /** Honeypot: real visitors never see or fill this. */
  website: z.string().max(500).optional(),
});

export type LeadInput = {
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  utm: Utm | null;
  notes: string;
  consent: boolean;
};

/** Pulls name/email/phone/message out of arbitrary form-field names. */
export function leadFromSubmissionData(formName: string, data: unknown): LeadInput | null {
  if (!data || typeof data !== 'object') return null;
  const entries = Object.entries(data as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), clip(v, 2000)] as const);
  const find = (re: RegExp) => entries.find(([k, v]) => re.test(k) && v)?.[1] ?? '';
  const email = normalizeEmail(find(/e-?mail/));
  const name = find(/^(full[\s_-]?)?name$|first[\s_-]?name|your[\s_-]?name/) || find(/name/);
  const phone = find(/phone|tel|mobile/);
  const message = find(/message|comment|enquiry|inquiry|details|note/);
  if (!email && !name && !phone) return null;
  const validEmail = email && isEmail(email) ? email : null;
  return {
    name: (name || validEmail?.split('@')[0] || 'Unknown').slice(0, 120),
    email: validEmail,
    phone: phone ? phone.slice(0, 40) : null,
    source: `form:${formName.slice(0, 60) || 'contact'}`,
    utm: null,
    notes: message ? `Message: ${message}` : '',
    consent: false,
  };
}

type Dedupable = { name: string; email: string | null; phone?: string | null; notes?: string };

/** Collapses rows sharing an email (case-insensitive); the first row wins, gaps are filled from later duplicates. */
export function dedupeByEmail<T extends Dedupable>(rows: T[]): { unique: T[]; duplicates: number } {
  const byEmail = new Map<string, T>();
  const unique: T[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = normalizeEmail(row.email);
    if (!key) {
      unique.push(row);
      continue;
    }
    const existing = byEmail.get(key);
    if (!existing) {
      const copy = { ...row, email: key };
      byEmail.set(key, copy);
      unique.push(copy);
      continue;
    }
    duplicates++;
    if (!existing.phone && row.phone) existing.phone = row.phone;
    if (!existing.notes && row.notes) existing.notes = row.notes;
  }
  return { unique, duplicates };
}

export type QualifiableLead = {
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  utm: unknown;
  notes: string;
  status: string;
  consent: boolean;
};

/** Only fields the lead actually provided are passed to the model; empty values are omitted, never guessed. */
export function buildQualificationInput(lead: QualifiableLead): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: string, v: string | null | undefined, max: number) => {
    const t = v?.trim();
    if (t) out[k] = t.slice(0, max);
  };
  set('name', lead.name, 120);
  set('email', lead.email, 254);
  set('phone', lead.phone, 40);
  set('source', lead.source, 80);
  set('notes', lead.notes, 1500);
  set('status', lead.status, 30);
  const utm = cleanUtm(lead.utm);
  if (utm) out.utm = Object.entries(utm).map(([k, v]) => `${k}=${v}`).join(', ');
  out.consentedToEmail = lead.consent ? 'yes' : 'no';
  return out;
}

export type Qualification = { score: number; reasons: string[]; nextAction: string };

/** Parses model output; score is clamped to 0-100 and reasons must be short strings. Returns null when unusable. */
export function parseQualification(raw: string): Qualification | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) return null;
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim().slice(0, 200)).slice(0, 5)
      : [];
    if (!reasons.length) return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      reasons,
      nextAction: clip(parsed.nextAction, 300),
    };
  } catch {
    return null;
  }
}

/** Completeness-only fallback when the model is unavailable; makes no judgement about intent. */
export function basicScore(input: Record<string, string>): Qualification {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (input.email) add(30, 'Provided an email address');
  if (input.phone) add(20, 'Provided a phone number');
  if (input.notes) add(20, 'Included a message');
  if (input.consentedToEmail === 'yes') add(20, 'Consented to email contact');
  if (input.utm) add(10, 'Arrived via a tracked campaign link');
  if (!reasons.length) reasons.push('Very little information provided');
  return { score, reasons, nextAction: '' };
}

export function sendBlockReason(input: {
  email: string | null;
  consent: boolean;
  optedOut: boolean;
  suppressed: boolean;
  sentToday: number;
  dailyLimit: number;
  draftStatus: string;
}): string | null {
  if (input.draftStatus !== 'DRAFT') return 'This draft was already handled.';
  if (!input.email) return 'This lead has no email address.';
  if (input.optedOut || input.suppressed) return 'This contact has opted out or is on the suppression list.';
  if (!input.consent) return 'This lead has not consented to be emailed.';
  if (input.sentToday >= input.dailyLimit) return 'Daily send limit reached for this project.';
  return null;
}

export const BOOKING_DURATIONS = [15, 30, 45, 60, 90] as const;

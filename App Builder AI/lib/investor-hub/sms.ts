import { createHmac, timingSafeEqual } from 'node:crypto';

import { isValidTimeZone } from '@/lib/ads/schedule';

/** Texts may only go out between these investor-local hours (start inclusive, end exclusive). */
export const QUIET_START_HOUR = 8;
export const QUIET_END_HOUR = 20;

export const CALL_OUTCOMES = [
  'CONNECTED',
  'VOICEMAIL',
  'NO_ANSWER',
  'WRONG_NUMBER',
  'NOT_INTERESTED',
  'MEETING_BOOKED',
  'FOLLOW_UP_LATER',
  'DO_NOT_CALL',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const OPT_OUT_FOOTER = 'Reply STOP to opt out.';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE']);

/** Standard carrier opt-out keywords (whole message, case-insensitive). */
export function isStopKeyword(text: string) {
  return STOP_WORDS.has(text.trim().replace(/[.!\s]+$/g, '').toUpperCase());
}

export function isValidE164(phone: string | null | undefined): phone is string {
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone);
}

/** Strips formatting; returns E.164 only when the number already has a "+" country code. */
export function normalizePhone(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[\s().-]/g, '');
  return isValidE164(cleaned) ? cleaned : null;
}

export function localHour(now: Date, timeZone: string): number | null {
  if (!isValidTimeZone(timeZone)) return null;
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);
  const n = Number(hour);
  return Number.isInteger(n) ? n : null;
}

/** Unknown or invalid time zones are never "inside" the window: we cannot prove it is a civil hour. */
export function insideSendWindow(now: Date, timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  const hour = localHour(now, timeZone);
  return hour !== null && hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

export type SmsGateInput = {
  phone: string | null;
  timezone: string | null;
  smsConsent: boolean;
  smsConsentAt: Date | null;
  smsOptedOut: boolean;
  investorOptedOut: boolean;
  now: Date;
};

/** Returns why a text must not be sent right now, or null when it may be. */
export function smsBlockReason(g: SmsGateInput): string | null {
  if (g.smsOptedOut) return 'This investor replied STOP and cannot be texted.';
  if (g.investorOptedOut) return 'This investor has opted out of contact.';
  if (!g.smsConsent || !g.smsConsentAt) return 'No recorded SMS consent for this investor.';
  if (!isValidE164(g.phone)) return 'Add the phone number in international format (+countrycode...).';
  if (!g.timezone || !isValidTimeZone(g.timezone)) return 'Set the investor time zone so quiet hours can be applied.';
  if (!insideSendWindow(g.now, g.timezone)) {
    return `Quiet hours: texts are only sent between ${String(QUIET_START_HOUR).padStart(2, '0')}:00 and ${QUIET_END_HOUR}:00 in the investor's time zone.`;
  }
  return null;
}

export function withOptOutFooter(body: string) {
  const text = body.trim();
  return /\bSTOP\b/i.test(text) ? text : `${text}\n${OPT_OUT_FOOTER}`;
}

export function twilioConfig() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  return { sid, token, from, service, configured: Boolean(sid && token && (from || service)) };
}

/** Twilio form body for POST Messages.json. */
export function buildTwilioBody(to: string, body: string, cfg: { from?: string; service?: string }) {
  const form = new URLSearchParams({ To: to, Body: body });
  if (cfg.service) form.set('MessagingServiceSid', cfg.service);
  else if (cfg.from) form.set('From', cfg.from);
  return form;
}

/** Validates X-Twilio-Signature: base64(HMAC-SHA1(url + sorted key/value pairs)). */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null) {
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = Buffer.from(createHmac('sha1', authToken).update(data).digest('base64'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type CallEffect = { stage: 'MEETING_SCHEDULED' | 'DECLINED' | null; stopSequence: boolean; optOut: boolean };

/** What a logged call outcome changes in the CRM; everything else only records the call. */
export function callEffect(outcome: CallOutcome): CallEffect {
  switch (outcome) {
    case 'MEETING_BOOKED':
      return { stage: 'MEETING_SCHEDULED', stopSequence: true, optOut: false };
    case 'NOT_INTERESTED':
      return { stage: 'DECLINED', stopSequence: true, optOut: false };
    case 'DO_NOT_CALL':
      return { stage: 'DECLINED', stopSequence: true, optOut: true };
    default:
      return { stage: null, stopSequence: false, optOut: false };
  }
}

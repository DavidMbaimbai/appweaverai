import { createHmac, timingSafeEqual } from 'node:crypto';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function secret() {
  const value = process.env.OUTREACH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!value) throw new Error('OUTREACH_SECRET (or CRON_SECRET) is not configured.');
  return value;
}

function sign(email: string) {
  return createHmac('sha256', secret()).update(normalizeEmail(email)).digest('base64url');
}

export function unsubscribeUrl(email: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://appweaverai.com').replace(/\/$/, '');
  const params = new URLSearchParams({ email: normalizeEmail(email), token: sign(email) });
  return `${base}/api/outreach/unsubscribe?${params}`;
}

export function verifyUnsubscribeToken(email: string, token: string) {
  const expected = Buffer.from(sign(email));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Appends the identification and opt-out footer that commercial email requires. */
export function withFooter({
  body,
  email,
  postalAddress,
}: {
  body: string;
  email: string;
  postalAddress: string;
}) {
  const link = unsubscribeUrl(email);
  const text = `${body.trim()}\n\n--\nDavid Mbaimbai, AppWeaver AI\n${postalAddress}\nYou received this one-time note because your investment focus is publicly listed. Don't want to hear from me? Opt out here: ${link}`;
  const escape = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:sans-serif;white-space:pre-wrap;">${escape(body.trim())}</div><hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"><div style="font-family:sans-serif;font-size:12px;color:#666;">David Mbaimbai, AppWeaver AI<br>${escape(postalAddress)}<br>You received this one-time note because your investment focus is publicly listed. <a href="${link}">Opt out</a></div>`;
  return { text, html, link };
}

/** Returns only values that literally appear in the page, so model hallucinations are dropped. */
export function verifyPublished(value: unknown, pageText: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return pageText.toLowerCase().includes(trimmed.toLowerCase()) ? trimmed : null;
}

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value) && value.length <= 254;
}

/** Blocks non-https and local/private targets before fetching a URL found via search. */
export function isSafePublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.includes(':')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return host.includes('.');
}

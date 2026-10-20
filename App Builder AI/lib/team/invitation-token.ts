import { createHmac, timingSafeEqual } from 'node:crypto';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationClaims = { id: string; version: number; expiresAt: number };

function secret() {
  const s = process.env.TEAM_INVITE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error('TEAM_INVITE_SECRET (or BETTER_AUTH_SECRET) is not set.');
  return s;
}

function mac(body: string) {
  return createHmac('sha256', secret()).update(`team-invite:${body}`).digest('base64url');
}

/** `<base64url claims>.<hmac>`; the version changes on resend, which invalidates earlier links. */
export function signInvitationToken(claims: InvitationClaims): string {
  const body = Buffer.from(JSON.stringify({ i: claims.id, v: claims.version, e: claims.expiresAt })).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function verifyInvitationToken(token: string, now = new Date()): InvitationClaims | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { i?: unknown; v?: unknown; e?: unknown };
    if (typeof parsed.i !== 'string' || !Number.isInteger(parsed.v) || typeof parsed.e !== 'number') return null;
    if (parsed.e <= now.getTime()) return null;
    return { id: parsed.i, version: parsed.v as number, expiresAt: parsed.e };
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInviteEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

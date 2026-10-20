import { createHash, createHmac } from 'node:crypto';

/** Prefix of a hashed identifier stored in place of a contact value (suppressions survive erasure as these). */
export const HASH_PREFIX = 'h1:';

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

/** Digits only, so "+49 151-234" and "49151234" compare equal. Returns null when there are too few digits to be a phone number. */
export function normalizePhoneDigits(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 6 ? digits : null;
}

export function privacySecret() {
  const secret = process.env.PRIVACY_HASH_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('PRIVACY_HASH_SECRET (or BETTER_AUTH_SECRET) is not configured.');
  return 'appweaver-privacy-development-secret';
}

/** Keyed hash: the stored value cannot be reversed or rainbow-tabled, but the same contact always hashes the same. */
export function hashIdentifier(kind: string, normalizedValue: string) {
  return HASH_PREFIX + createHmac('sha256', privacySecret()).update(`${kind}:${normalizedValue}`).digest('hex');
}

export const hashEmail = (email: string) => hashIdentifier('email', normalizeEmailAddress(email));

export function hashPhone(phone: string) {
  const digits = normalizePhoneDigits(phone);
  return digits ? hashIdentifier('phone', digits) : null;
}

/** Hash of an already channel-normalised messaging contact (see messaging/gates normalizeContact). */
export const hashContact = (channel: string, normalizedContact: string) => hashIdentifier(`contact:${channel}`, normalizedContact);

export const isHashedKey = (value: string) => value.startsWith(HASH_PREFIX);

/** Unkeyed digest for non-reversible request metadata (IP addresses). */
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function erasedEmailFor(userId: string) {
  return `erased-${userId}@erased.invalid`;
}

export const isErasedEmail = (email: string | null | undefined) => Boolean(email?.endsWith('@erased.invalid'));

import { createHmac, randomBytes } from 'node:crypto';

/**
 * One-way HMAC-SHA256 hashing for CLI access tokens (and similar bearer
 * tokens) using BETTER_AUTH_SECRET as the key. Unlike lib/crypto/secret-box.ts
 * this is intentionally non-reversible: we only ever need to check that an
 * incoming token matches a stored hash, never recover the original value.
 */
function deriveHmacKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required to hash tokens.');
  }
  return secret;
}

export function hashToken(rawToken: string): string {
  return createHmac('sha256', deriveHmacKey())
    .update(rawToken)
    .digest('hex');
}

/** Generates a random opaque bearer token with a recognizable prefix. */
export function generateRawToken(prefix = 'awa_cli'): string {
  return `${prefix}_${randomBytes(32).toString('hex')}`;
}

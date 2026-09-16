import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Minimal AES-256-GCM "secret box" for encrypting small application-layer
 * secrets at rest (e.g. a user's GitHub personal access token) using
 * BETTER_AUTH_SECRET as the key material. Not meant for large payloads.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required to encrypt secrets.');
  }
  return scryptSync(secret, 'appweaverai-secret-box', 32);
}

export function encryptSecret(plainText: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted]
    .map((buffer) => buffer.toString('base64'))
    .join('.');
}

export function decryptSecret(encoded: string): string {
  const [ivB64, authTagB64, encryptedB64] = encoded.split('.');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Malformed encrypted secret.');
  }

  const key = deriveKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

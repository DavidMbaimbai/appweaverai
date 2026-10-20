import { createHash, randomBytes } from 'node:crypto';

export type MediaKindName = 'IMAGE' | 'VIDEO';

export const MEDIA_LIMITS: Record<MediaKindName, { maxBytes: number; types: readonly string[] }> = {
  IMAGE: { maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png'] },
  VIDEO: { maxBytes: 512 * 1024 * 1024, types: ['video/mp4'] },
};

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4' };

/** Detects the real type from magic bytes so a declared content type cannot be spoofed. */
export function sniffContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') return 'video/mp4';
  return null;
}

export type ValidatedMedia = { contentType: string; sizeBytes: number; sha256: string };

export function validateMedia(input: {
  kind: MediaKindName;
  bytes: Uint8Array;
  contentType: string;
  expectedSha256?: string;
}): ({ ok: true } & ValidatedMedia) | { ok: false; error: string } {
  const limits = MEDIA_LIMITS[input.kind];
  if (input.bytes.length === 0) return { ok: false, error: 'The file is empty.' };
  if (input.bytes.length > limits.maxBytes) {
    return { ok: false, error: `The file is larger than the ${Math.round(limits.maxBytes / 1024 / 1024)} MB limit.` };
  }
  if (!limits.types.includes(input.contentType)) {
    return { ok: false, error: `Content type ${input.contentType} is not allowed for ${input.kind.toLowerCase()}s.` };
  }
  const sniffed = sniffContentType(input.bytes);
  if (sniffed !== input.contentType) return { ok: false, error: 'The file contents do not match the declared content type.' };
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256) {
    return { ok: false, error: 'The file checksum does not match.' };
  }
  return { ok: true, contentType: input.contentType, sizeBytes: input.bytes.length, sha256 };
}

/** Keys are scoped by project (or PLATFORM) and never contain user-supplied path parts. */
export function buildMediaKey(input: {
  scopeKey: string;
  visibility: 'PRIVATE' | 'PUBLIC';
  contentType: string;
  sha256: string;
  now?: Date;
}): string {
  const scope = input.scopeKey === 'PLATFORM' ? 'platform' : `p-${input.scopeKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;
  const ext = EXTENSIONS[input.contentType];
  if (!ext) throw new Error(`Unsupported content type ${input.contentType}.`);
  const month = (input.now ?? new Date()).toISOString().slice(0, 7);
  return `media/${input.visibility === 'PUBLIC' ? 'public' : 'private'}/${scope}/${month}/${input.sha256.slice(0, 16)}-${randomBytes(4).toString('hex')}.${ext}`;
}

const REF = /^media:\/\/([A-Za-z0-9_-]{8,40})$/;

export const mediaRef = (assetId: string) => `media://${assetId}`;

export function parseMediaRef(value: string | null | undefined): string | null {
  const match = value ? REF.exec(value.trim()) : null;
  return match ? match[1] : null;
}

/** True when a URL signed to `expiresAt` is still valid long enough for the platform to fetch it. */
export function ttlSufficient(expiresAt: Date | null, publishAt: Date, marginMs: number): boolean {
  return expiresAt === null || expiresAt.getTime() >= publishAt.getTime() + marginMs;
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function backoffMs(attempt: number, baseMs: number, maxMs: number) {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

/** Runs `fn` until it returns a value other than `undefined` ("not ready yet"); throws after `attempts`. */
export async function pollWithBackoff<T>(
  fn: (attempt: number) => Promise<T | undefined>,
  opts: { attempts: number; baseMs: number; maxMs: number; sleep?: Sleep },
): Promise<T | undefined> {
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    const result = await fn(attempt);
    if (result !== undefined) return result;
    if (attempt < opts.attempts - 1) await sleep(backoffMs(attempt, opts.baseMs, opts.maxMs));
  }
  return undefined;
}

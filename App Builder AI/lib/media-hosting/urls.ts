import { prisma } from '@/lib/prisma';
import { getVideoObjectBytes, presignVideoUrl } from '@/lib/video/storage';

import { pollWithBackoff, ttlSufficient, type Sleep } from './logic';

const MAX_PRESIGN_SECONDS = 7 * 24 * 3600;
export const URL_MARGIN_MS = 15 * 60_000;

export function mediaPublicBase(): string | null {
  const base = process.env.MEDIA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  return base && /^https:\/\//i.test(base) ? base : null;
}

/** Default lifetime of presigned links; long enough for platforms that fetch media asynchronously. */
export function defaultUrlTtlSeconds() {
  const raw = Number(process.env.MEDIA_URL_TTL_SECONDS);
  return Number.isFinite(raw) && raw >= 300 ? Math.min(raw, MAX_PRESIGN_SECONDS) : 24 * 3600;
}

type AssetLike = { key: string; visibility: 'PRIVATE' | 'PUBLIC' };
export type ResolvedUrl = { url: string; expiresAt: Date | null; permanent: boolean };

/** Permanent CDN URL for public assets when MEDIA_PUBLIC_BASE_URL is set; otherwise a presigned GET that outlives `publishAt` plus a margin. */
export async function resolveMediaUrl(
  asset: AssetLike,
  opts: { publishAt?: Date; now?: Date; marginMs?: number } = {},
): Promise<ResolvedUrl> {
  const base = mediaPublicBase();
  if (base && asset.visibility === 'PUBLIC') {
    return { url: `${base}/${asset.key}`, expiresAt: null, permanent: true };
  }
  const now = opts.now ?? new Date();
  const needed = opts.publishAt ? Math.ceil((opts.publishAt.getTime() - now.getTime() + (opts.marginMs ?? URL_MARGIN_MS)) / 1000) : 0;
  const ttl = Math.min(MAX_PRESIGN_SECONDS, Math.max(defaultUrlTtlSeconds(), needed));
  const url = await presignVideoUrl(asset.key, { expiresIn: ttl });
  return { url, expiresAt: new Date(now.getTime() + ttl * 1000), permanent: false };
}

export type VerifyOptions = {
  contentTypes: readonly string[];
  maxBytes: number;
  expectedSize?: number;
  fetchImpl?: typeof fetch;
};
export type VerifyResult = { ok: true; contentType: string; size: number | null } | { ok: false; error: string; expired?: boolean };

/** Fetches headers the way a platform would (HEAD, then a 1-byte ranged GET) and checks type and length. */
export async function verifyMediaUrl(url: string, opts: VerifyOptions): Promise<VerifyResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    if (response.status === 405 || response.status === 501) {
      response = await doFetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15_000) });
    }
  } catch (error) {
    return { ok: false, error: `The media URL could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 403 || response.status === 401) {
    return { ok: false, error: `The media URL is not accessible (HTTP ${response.status}); it may have expired.`, expired: true };
  }
  if (!response.ok) return { ok: false, error: `The media URL returned HTTP ${response.status}.` };

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!opts.contentTypes.includes(contentType)) {
    return { ok: false, error: `The media URL serves ${contentType || 'no content type'}, expected ${opts.contentTypes.join(' or ')}.` };
  }
  const range = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  const lengthHeader = range ? range[1] : response.headers.get('content-length');
  const size = lengthHeader !== null && lengthHeader !== '' ? Number(lengthHeader) : null;
  if (size === null || !Number.isFinite(size) || size <= 0) return { ok: false, error: 'The media URL did not report a content length.' };
  if (size > opts.maxBytes) return { ok: false, error: 'The hosted file exceeds the platform size limit.' };
  if (opts.expectedSize !== undefined && size !== opts.expectedSize) {
    return { ok: false, error: `The hosted file is ${size} bytes, expected ${opts.expectedSize}.` };
  }
  return { ok: true, contentType, size };
}

export type PublishableMedia =
  | { ok: true; url: string; contentType: string; sizeBytes: number; assetId: string; key: string; permanent: boolean }
  | { ok: false; error: string };

/** Resolves an asset to a URL platforms can fetch right now: signed long enough, reachable, right type and size. Re-signs once if the first URL fails as expired. */
export async function ensurePublishableMedia(
  assetId: string,
  opts: { publishAt?: Date; now?: Date; acceptTypes?: readonly string[]; maxBytes: number; fetchImpl?: typeof fetch; scopeKey?: string },
): Promise<PublishableMedia> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== 'READY') return { ok: false, error: 'The media asset is missing or failed to upload.' };
  if (opts.scopeKey && asset.scopeKey !== opts.scopeKey) return { ok: false, error: 'The media asset belongs to a different project.' };
  const accept = (opts.acceptTypes ?? [asset.contentType]).filter((t) => t === asset.contentType);
  if (accept.length === 0) return { ok: false, error: `This platform does not accept ${asset.contentType}.` };

  const publishAt = opts.publishAt ?? opts.now ?? new Date();
  let last = 'Media could not be verified.';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolved = await resolveMediaUrl(asset, { publishAt, now: opts.now, marginMs: attempt === 0 ? URL_MARGIN_MS : 2 * URL_MARGIN_MS });
    if (!ttlSufficient(resolved.expiresAt, publishAt, URL_MARGIN_MS)) {
      last = 'The media URL would expire before it can be used.';
      continue;
    }
    const verified = await verifyMediaUrl(resolved.url, {
      contentTypes: accept,
      maxBytes: opts.maxBytes,
      expectedSize: asset.sizeBytes,
      fetchImpl: opts.fetchImpl,
    });
    if (verified.ok) {
      return { ok: true, url: resolved.url, contentType: asset.contentType, sizeBytes: asset.sizeBytes, assetId: asset.id, key: asset.key, permanent: resolved.permanent };
    }
    last = verified.error;
    if (!verified.expired) break;
  }
  return { ok: false, error: last };
}

export async function loadMediaBytes(assetId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== 'READY') return null;
  return { bytes: await getVideoObjectBytes(asset.key), contentType: asset.contentType };
}

export type ProcessingState = 'FINISHED' | 'IN_PROGRESS' | 'ERROR';

/** Polls a platform's media-processing status with exponential backoff; only FINISHED counts as success. */
export async function waitForProcessing(
  check: () => Promise<{ state: ProcessingState; detail?: string }>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number; sleep?: Sleep } = {},
): Promise<{ ok: true } | { ok: false; error: string; retryable: boolean }> {
  let failure: string | null = null;
  const done = await pollWithBackoff<boolean>(
    async () => {
      const status = await check();
      if (status.state === 'FINISHED') return true;
      if (status.state === 'ERROR') {
        failure = status.detail ?? 'The platform could not process the media.';
        return false;
      }
      return undefined;
    },
    { attempts: opts.attempts ?? 6, baseMs: opts.baseMs ?? 1000, maxMs: opts.maxMs ?? 15_000, sleep: opts.sleep },
  );
  if (done === true) return { ok: true };
  if (done === false) return { ok: false, error: failure ?? 'The platform could not process the media.', retryable: false };
  return { ok: false, error: 'The platform is still processing the media; it was not published.', retryable: true };
}

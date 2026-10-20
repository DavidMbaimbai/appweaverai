import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
}));
const s3 = vi.hoisted(() => ({
  config: vi.fn(),
  put: vi.fn(),
  size: vi.fn(),
  presign: vi.fn(),
  bytes: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { mediaAsset: db } }));
vi.mock('@/lib/video/storage', () => ({
  getVideoStorageConfig: s3.config,
  putVideoObject: s3.put,
  getVideoObjectSize: s3.size,
  presignVideoUrl: s3.presign,
  getVideoObjectBytes: s3.bytes,
}));

import { buildMediaKey, mediaRef, parseMediaRef, pollWithBackoff, sniffContentType, ttlSufficient, validateMedia } from './logic';
import { uploadMedia } from './upload';
import { ensurePublishableMedia, resolveMediaUrl, verifyMediaUrl, waitForProcessing } from './urls';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const noSleep = async () => undefined;

function response(status: number, headers: Record<string, string>) {
  return new Response(null, { status, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MEDIA_PUBLIC_BASE_URL;
  s3.config.mockReturnValue({ ok: true, bucket: 'b', region: 'us-east-1' });
  s3.presign.mockResolvedValue('https://s3.example/signed');
});

describe('validation and keys', () => {
  it('rejects spoofed, oversized and empty files', () => {
    expect(validateMedia({ kind: 'IMAGE', bytes: Buffer.from('<html>'), contentType: 'image/jpeg' }).ok).toBe(false);
    expect(validateMedia({ kind: 'IMAGE', bytes: Buffer.alloc(0), contentType: 'image/jpeg' }).ok).toBe(false);
    expect(validateMedia({ kind: 'IMAGE', bytes: JPEG, contentType: 'image/gif' }).ok).toBe(false);
    expect(validateMedia({ kind: 'IMAGE', bytes: JPEG, contentType: 'image/jpeg', expectedSha256: 'bad' }).ok).toBe(false);
    const big = Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]);
    expect(validateMedia({ kind: 'IMAGE', bytes: big, contentType: 'image/jpeg' }).ok).toBe(false);
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
  });
  it('scopes keys by project without path tricks', () => {
    const key = buildMediaKey({ scopeKey: '../evil/proj', visibility: 'PRIVATE', contentType: 'image/jpeg', sha256: 'a'.repeat(64) });
    expect(key).toMatch(/^media\/private\/p-evilproj\/\d{4}-\d{2}\/aaaaaaaaaaaaaaaa-[0-9a-f]{8}\.jpg$/);
    expect(buildMediaKey({ scopeKey: 'PLATFORM', visibility: 'PUBLIC', contentType: 'video/mp4', sha256: 'b'.repeat(64) })).toContain('media/public/platform/');
  });
  it('round-trips media references', () => {
    expect(parseMediaRef(mediaRef('clx1234567890'))).toBe('clx1234567890');
    expect(parseMediaRef('https://x.com/a.jpg')).toBeNull();
  });
  it('checks remaining TTL against publish time plus margin', () => {
    const publish = new Date('2026-01-01T12:00:00Z');
    expect(ttlSufficient(new Date('2026-01-01T12:10:00Z'), publish, 15 * 60_000)).toBe(false);
    expect(ttlSufficient(new Date('2026-01-01T13:00:00Z'), publish, 15 * 60_000)).toBe(true);
    expect(ttlSufficient(null, publish, 15 * 60_000)).toBe(true);
  });
});

describe('uploadMedia', () => {
  const input = { scope: { scopeKey: 'proj1' }, kind: 'IMAGE' as const, bytes: JPEG, contentType: 'image/jpeg', sleep: noSleep };

  it('retries transient failures and records a READY asset', async () => {
    s3.put.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined);
    s3.size.mockResolvedValue(JPEG.length);
    db.create.mockImplementation(async ({ data }) => ({ id: 'a1', ...data }));
    const result = await uploadMedia(input);
    expect(result.ok).toBe(true);
    expect(s3.put).toHaveBeenCalledTimes(2);
    expect(db.create.mock.calls[0][0].data.status).toBe('READY');
  });

  it('never reports success when every attempt fails', async () => {
    s3.put.mockRejectedValue(new Error('AccessDenied'));
    db.create.mockImplementation(async ({ data }) => ({ id: 'a2', ...data }));
    const result = await uploadMedia(input);
    expect(result).toMatchObject({ ok: false });
    expect(s3.put).toHaveBeenCalledTimes(3);
    expect(db.create.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('fails when the stored size does not match', async () => {
    s3.put.mockResolvedValue(undefined);
    s3.size.mockResolvedValue(1);
    db.create.mockResolvedValue({});
    expect((await uploadMedia({ ...input, attempts: 1 })).ok).toBe(false);
  });

  it('fails clearly when storage is not configured', async () => {
    s3.config.mockReturnValue({ ok: false, reason: 'not configured' });
    expect(await uploadMedia(input)).toEqual({ ok: false, error: 'not configured' });
  });

  it('reuses the asset when a run is retried', async () => {
    db.findFirst.mockResolvedValue({ id: 'existing' });
    const result = await uploadMedia({ ...input, contentRunId: 'run1' });
    expect(result).toMatchObject({ ok: true, reused: true });
    expect(s3.put).not.toHaveBeenCalled();
  });
});

describe('URL resolution and verification', () => {
  const asset = { key: 'media/public/p-1/x.jpg', visibility: 'PUBLIC' as const };

  it('serves public assets from the CDN only when MEDIA_PUBLIC_BASE_URL is set', async () => {
    expect((await resolveMediaUrl(asset)).permanent).toBe(false);
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://cdn.example.com/';
    expect(await resolveMediaUrl(asset)).toEqual({ url: 'https://cdn.example.com/media/public/p-1/x.jpg', expiresAt: null, permanent: true });
    expect((await resolveMediaUrl({ ...asset, visibility: 'PRIVATE' })).permanent).toBe(false);
  });

  it('signs long enough to cover a future publish time', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    await resolveMediaUrl({ ...asset, visibility: 'PRIVATE' }, { now, publishAt: new Date('2026-01-03T00:00:00Z') });
    expect(s3.presign.mock.calls[0][1].expiresIn).toBeGreaterThanOrEqual(2 * 24 * 3600);
  });

  it('checks content type and length', async () => {
    const ok = vi.fn().mockResolvedValue(response(200, { 'content-type': 'image/jpeg', 'content-length': '8' }));
    expect(await verifyMediaUrl('https://x/a', { contentTypes: ['image/jpeg'], maxBytes: 100, expectedSize: 8, fetchImpl: ok })).toMatchObject({ ok: true });
    const wrongType = vi.fn().mockResolvedValue(response(200, { 'content-type': 'text/html', 'content-length': '8' }));
    expect((await verifyMediaUrl('https://x/a', { contentTypes: ['image/jpeg'], maxBytes: 100, fetchImpl: wrongType })).ok).toBe(false);
    const wrongSize = vi.fn().mockResolvedValue(response(200, { 'content-type': 'image/jpeg', 'content-length': '9' }));
    expect((await verifyMediaUrl('https://x/a', { contentTypes: ['image/jpeg'], maxBytes: 100, expectedSize: 8, fetchImpl: wrongSize })).ok).toBe(false);
    const missing = vi.fn().mockResolvedValue(response(200, { 'content-type': 'image/jpeg' }));
    expect((await verifyMediaUrl('https://x/a', { contentTypes: ['image/jpeg'], maxBytes: 100, fetchImpl: missing })).ok).toBe(false);
  });

  it('falls back to a ranged GET when HEAD is not allowed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(405, {}))
      .mockResolvedValueOnce(response(206, { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/8' }));
    expect(await verifyMediaUrl('https://x/a', { contentTypes: ['image/jpeg'], maxBytes: 100, expectedSize: 8, fetchImpl })).toMatchObject({ ok: true, size: 8 });
  });

  it('re-signs once when the first URL has expired, and fails if it still cannot be fetched', async () => {
    db.findUnique.mockResolvedValue({ id: 'a', key: 'k.jpg', visibility: 'PRIVATE', status: 'READY', contentType: 'image/jpeg', sizeBytes: 8, scopeKey: 'p1' });
    const recovered = vi
      .fn()
      .mockResolvedValueOnce(response(403, {}))
      .mockResolvedValueOnce(response(200, { 'content-type': 'image/jpeg', 'content-length': '8' }));
    const good = await ensurePublishableMedia('a', { maxBytes: 100, fetchImpl: recovered, scopeKey: 'p1' });
    expect(good.ok).toBe(true);
    expect(s3.presign).toHaveBeenCalledTimes(2);

    const dead = vi.fn().mockResolvedValue(response(403, {}));
    expect((await ensurePublishableMedia('a', { maxBytes: 100, fetchImpl: dead })).ok).toBe(false);
  });

  it('refuses assets from another project or that failed to upload', async () => {
    db.findUnique.mockResolvedValue({ id: 'a', key: 'k', visibility: 'PRIVATE', status: 'READY', contentType: 'image/jpeg', sizeBytes: 8, scopeKey: 'other' });
    expect((await ensurePublishableMedia('a', { maxBytes: 100, scopeKey: 'p1' })).ok).toBe(false);
    db.findUnique.mockResolvedValue({ id: 'a', status: 'FAILED' });
    expect((await ensurePublishableMedia('a', { maxBytes: 100 })).ok).toBe(false);
  });

  it('rejects a platform that does not accept the stored type', async () => {
    db.findUnique.mockResolvedValue({ id: 'a', key: 'k', visibility: 'PRIVATE', status: 'READY', contentType: 'image/png', sizeBytes: 8, scopeKey: 'p1' });
    expect((await ensurePublishableMedia('a', { maxBytes: 100, acceptTypes: ['image/jpeg'] })).ok).toBe(false);
  });
});

describe('processing polls', () => {
  it('backs off and only succeeds on FINISHED', async () => {
    const sleep = vi.fn(async (ms: number) => { void ms; });
    const states = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'] as const;
    let i = 0;
    const result = await waitForProcessing(async () => ({ state: states[i++] }), { baseMs: 100, maxMs: 1000, sleep });
    expect(result).toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it('does not assume success when processing never finishes', async () => {
    const result = await waitForProcessing(async () => ({ state: 'IN_PROGRESS' }), { attempts: 3, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it('reports platform errors as final', async () => {
    const result = await waitForProcessing(async () => ({ state: 'ERROR', detail: 'bad aspect ratio' }), { sleep: noSleep });
    expect(result).toEqual({ ok: false, error: 'bad aspect ratio', retryable: false });
  });

  it('pollWithBackoff returns undefined after the last attempt', async () => {
    expect(await pollWithBackoff(async () => undefined, { attempts: 2, baseMs: 1, maxMs: 2, sleep: noSleep })).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('@/lib/media-hosting/urls', async () => {
  const actual = await vi.importActual<typeof import('@/lib/media-hosting/urls')>('@/lib/media-hosting/urls');
  return { ...actual, loadMediaBytes: media.load };
});
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/video/storage', () => ({}));

import { instagramContainerState, uploadLinkedInImage, uploadXImage } from './media';

const file = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), contentType: 'image/jpeg' };
const asset = { assetId: 'asset12345', url: 'https://x/y', contentType: 'image/jpeg' };

beforeEach(() => {
  vi.clearAllMocks();
  media.load.mockResolvedValue(file);
});

describe('X image upload', () => {
  it('returns the media id from the v2 upload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'm1' } }), { status: 200 }));
    expect(await uploadXImage('t', asset, fetchImpl)).toEqual({ ok: true, value: 'm1' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.x.com/2/media/upload');
  });
  it('fails honestly when X rejects the upload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    expect(await uploadXImage('t', asset, fetchImpl)).toMatchObject({ ok: false });
  });
  it('fails when the stored image is gone', async () => {
    media.load.mockResolvedValue(null);
    expect((await uploadXImage('t', asset, vi.fn())).ok).toBe(false);
  });
});

describe('LinkedIn image upload', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it('registers, uploads and waits until the image is available', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ value: { uploadUrl: 'https://upload/u', image: 'urn:li:image:1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(json({ status: 'PROCESSING' }))
      .mockResolvedValueOnce(json({ status: 'AVAILABLE' }));
    const result = await uploadLinkedInImage('t', 'member', asset, { fetchImpl, sleep: async () => undefined });
    expect(result).toEqual({ ok: true, value: 'urn:li:image:1' });
  });
  it('does not return an image that failed processing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ value: { uploadUrl: 'https://upload/u', image: 'urn:li:image:1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(json({ status: 'PROCESSING_FAILED' }));
    expect((await uploadLinkedInImage('t', 'member', asset, { fetchImpl, sleep: async () => undefined })).ok).toBe(false);
  });
});

describe('Instagram container state', () => {
  it('maps status codes', () => {
    expect(instagramContainerState('FINISHED')).toBe('FINISHED');
    expect(instagramContainerState('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(instagramContainerState(undefined)).toBe('IN_PROGRESS');
    expect(instagramContainerState('EXPIRED')).toBe('ERROR');
  });
});

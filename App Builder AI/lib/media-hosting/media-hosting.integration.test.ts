import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma } from '@/tests/integration/db';

const s3 = vi.hoisted(() => ({
  objects: new Map<string, { body: Buffer; contentType: string }>(),
  failPuts: 0,
}));

vi.mock('@/lib/video/storage', () => ({
  getVideoStorageConfig: () => ({ ok: true, bucket: 'test-bucket', region: 'us-east-1' }),
  putVideoObject: vi.fn(async (key: string, body: Buffer, contentType: string) => {
    if (s3.failPuts > 0) {
      s3.failPuts -= 1;
      throw new Error('SlowDown: S3 throttled');
    }
    s3.objects.set(key, { body, contentType });
  }),
  getVideoObjectSize: vi.fn(async (key: string) => s3.objects.get(key)?.body.length ?? null),
  getVideoObjectBytes: vi.fn(async (key: string) => s3.objects.get(key)!.body),
  presignVideoUrl: vi.fn(async (key: string) => `https://s3.test/${key}?sig=1`),
}));

import { mediaRef, parseMediaRef } from './logic';
import { uploadMedia } from './upload';
import { ensurePublishableMedia } from './urls';

const png = (seed = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([seed, 1, 2, 3])]);
const noSleep = async () => undefined;

beforeEach(() => {
  s3.objects.clear();
  s3.failPuts = 0;
});

describe('media hosting (real Postgres, mocked S3)', () => {
  it('stores an asset and associates it with a project post', async () => {
    const owner = await makeUser();
    const { project } = await makeProjectFor(owner);
    const uploaded = await uploadMedia({
      scope: { scopeKey: project.id, projectId: project.id, ownerUserId: owner.id },
      kind: 'IMAGE',
      bytes: png(),
      contentType: 'image/png',
    });
    if (!uploaded.ok) throw new Error(uploaded.error);
    expect(s3.objects.has(uploaded.asset.key)).toBe(true);
    expect(uploaded.asset.key).toContain(`p-${project.id.replace(/[^A-Za-z0-9]/g, '')}`);

    const campaign = await prisma.projectCampaign.create({
      data: { projectId: project.id, userId: owner.id, name: 'Launch' },
    });
    const post = await prisma.projectPost.create({
      data: { campaignId: campaign.id, platform: 'X', text: 'Hi', imageUrl: mediaRef(uploaded.asset.id) },
    });
    await prisma.mediaAsset.update({
      where: { id: uploaded.asset.id },
      data: { linkedType: 'ProjectPost', linkedId: post.id },
    });

    const reloaded = await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } });
    const assetId = parseMediaRef(reloaded.imageUrl);
    const linked = await prisma.mediaAsset.findFirstOrThrow({ where: { linkedType: 'ProjectPost', linkedId: post.id } });
    expect(assetId).toBe(uploaded.asset.id);
    expect(linked.status).toBe('READY');

    const head = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(uploaded.asset.sizeBytes) },
      }),
    );
    const publishable = await ensurePublishableMedia(uploaded.asset.id, {
      maxBytes: 8 * 1024 * 1024,
      scopeKey: project.id,
      fetchImpl: head as unknown as typeof fetch,
    });
    expect(publishable.ok).toBe(true);
  });

  it('reuses the asset for the same content run instead of uploading twice', async () => {
    const owner = await makeUser();
    const { project } = await makeProjectFor(owner);
    const input = {
      scope: { scopeKey: project.id, projectId: project.id },
      kind: 'IMAGE' as const,
      bytes: png(),
      contentType: 'image/png',
      contentRunId: 'run_1',
    };
    const first = await uploadMedia(input);
    const second = await uploadMedia(input);
    expect(first.ok && second.ok && second.reused && second.asset.id === first.asset.id).toBe(true);
    expect(await prisma.mediaAsset.count()).toBe(1);
  });

  it('retries a transient S3 failure and then succeeds', async () => {
    s3.failPuts = 2;
    const result = await uploadMedia({
      scope: { scopeKey: 'PLATFORM' },
      kind: 'IMAGE',
      bytes: png(3),
      contentType: 'image/png',
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(await prisma.mediaAsset.count({ where: { status: 'READY' } })).toBe(1);
    expect(await prisma.mediaAsset.count({ where: { status: 'FAILED' } })).toBe(0);
  });

  it('records a FAILED asset (never READY) when every attempt fails', async () => {
    s3.failPuts = 99;
    const result = await uploadMedia({
      scope: { scopeKey: 'PLATFORM' },
      kind: 'IMAGE',
      bytes: png(4),
      contentType: 'image/png',
      sleep: noSleep,
    });
    expect(result.ok).toBe(false);
    const rows = await prisma.mediaAsset.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'FAILED' });
    expect(rows[0].error).toContain('S3 throttled');
    expect((await ensurePublishableMedia(rows[0].id, { maxBytes: 1_000_000 })).ok).toBe(false);
  });

  it("refuses to publish one project's asset under another project's scope", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { project: projectA } = await makeProjectFor(a);
    const { project: projectB } = await makeProjectFor(b);
    const uploaded = await uploadMedia({
      scope: { scopeKey: projectB.id, projectId: projectB.id, ownerUserId: b.id },
      kind: 'IMAGE',
      bytes: png(5),
      contentType: 'image/png',
    });
    if (!uploaded.ok) throw new Error(uploaded.error);
    const result = await ensurePublishableMedia(uploaded.asset.id, { maxBytes: 1_000_000, scopeKey: projectA.id });
    expect(result).toEqual({ ok: false, error: 'The media asset belongs to a different project.' });
  });

  it('rejects content that does not match its declared type without storing anything', async () => {
    const result = await uploadMedia({
      scope: { scopeKey: 'PLATFORM' },
      kind: 'IMAGE',
      bytes: Buffer.from('not an image at all'),
      contentType: 'image/png',
    });
    expect(result.ok).toBe(false);
    expect(s3.objects.size).toBe(0);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});

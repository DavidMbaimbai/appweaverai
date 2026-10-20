import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '@/lib/crypto/secret-box';
import { getWallet, grantCredits } from '@/lib/marketing-credits/wallet';
import { makeUser, prisma, uid } from '@/tests/integration/db';

const publish = vi.hoisted(() => vi.fn());

vi.mock('@/lib/video-release/notify', () => ({ notifyOwner: vi.fn(async () => true) }));
vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn(async () => undefined) }));
vi.mock('@/lib/video/storage', () => ({
  getVideoStorageConfig: () => ({ ok: true, bucket: 'test-bucket', region: 'us-east-1' }),
  getVideoObjectSize: vi.fn(async () => 5_000_000),
  getVideoObjectBytes: vi.fn(async () => Buffer.from('video')),
  presignVideoUrl: vi.fn(async (key: string) => `https://s3.test/${key}`),
}));
vi.mock('./adapters', () => ({ PUBLISHERS: new Proxy({}, { get: () => ({ publish }) }) }));
vi.mock('./adapters/youtube', () => ({ fetchYoutubeMetrics: vi.fn(async () => null) }));

import { runVideoReleases } from './run';

const realNow = () => new Date();

async function seed(opts: { status?: 'APPROVED' | 'SCHEDULED'; credits?: number } = {}) {
  const user = await makeUser();
  await prisma.socialConnection.create({
    data: { userId: user.id, platform: 'YOUTUBE', accessTokenEnc: encryptSecret('yt-token'), accountId: 'chan' },
  });
  await prisma.marketingPriceItem.create({
    data: {
      operation: 'publish_post',
      version: 1,
      name: 'Publish post',
      creditCost: 2,
      billable: true,
      maxFactor: 1,
      planRestrictions: [],
      effectiveFrom: new Date('2020-01-01'),
    },
  });
  await grantCredits({ userId: user.id, amount: opts.credits ?? 10, source: 'PURCHASED', idempotencyKey: `g:${user.id}` });
  const job = await prisma.videoJob.create({
    data: {
      userId: user.id,
      providerId: 'test',
      model: 'm',
      mode: 'TEXT',
      prompt: 'a video',
      seconds: 30,
      aspect: '16:9',
      status: 'SUCCEEDED',
      outputKey: 'videos/out.mp4',
      idempotencyKey: uid('job'),
    },
  });
  const release = await prisma.videoRelease.create({
    data: {
      userId: user.id,
      jobId: job.id,
      platform: 'YOUTUBE',
      title: 'My video',
      caption: 'Watch this',
      hashtags: ['demo'],
      scheduledAt: new Date(Date.now() - 10 * 60_000),
      status: opts.status ?? 'APPROVED',
      approvedAt: opts.status === 'SCHEDULED' ? null : new Date(),
      approvedBy: opts.status === 'SCHEDULED' ? null : user.id,
      idempotencyKey: uid('rel'),
    },
  });
  return { user, job, release };
}

describe('video release scheduling and publishing (real Postgres, mocked platform)', () => {
  beforeEach(() => {
    publish.mockReset();
    // Makes YouTube an automatic platform; no request is ever made with these values.
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  });

  it('rejects a second release with the same idempotency key', async () => {
    const { release } = await seed();
    await expect(
      prisma.videoRelease.create({
        data: {
          userId: release.userId,
          jobId: release.jobId,
          platform: 'YOUTUBE',
          title: 'dup',
          scheduledAt: release.scheduledAt,
          idempotencyKey: release.idempotencyKey,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('publishes an approved release once; re-runs and concurrent runs do not post again', async () => {
    const { user, release } = await seed();
    publish.mockResolvedValue({ ok: true, externalId: 'yt-1', postUrl: 'https://youtu.be/yt-1' });

    const summaries = await Promise.all([runVideoReleases(realNow()), runVideoReleases(realNow())]);
    await runVideoReleases(realNow());

    expect(summaries.reduce((n, s) => n + s.published, 0)).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await prisma.videoRelease.findUniqueOrThrow({ where: { id: release.id } })).toMatchObject({
      status: 'PUBLISHED',
      externalId: 'yt-1',
      attempts: 1,
    });
    expect(await getWallet(user.id)).toMatchObject({ available: 8, reserved: 0 });
  });

  it('never publishes a release the owner has not approved', async () => {
    const { release } = await seed({ status: 'SCHEDULED' });
    await runVideoReleases(realNow());
    expect(publish).not.toHaveBeenCalled();
    expect((await prisma.videoRelease.findUniqueOrThrow({ where: { id: release.id } })).status).toBe('SCHEDULED');
  });

  it('recovers from a provider crash: credits released, then the retry succeeds', async () => {
    const { user, release } = await seed();
    publish.mockRejectedValueOnce(new Error('provider exploded')).mockResolvedValueOnce({
      ok: true,
      externalId: 'yt-2',
      postUrl: 'https://youtu.be/yt-2',
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const first = await runVideoReleases(realNow());
    quiet.mockRestore();
    expect(first).toMatchObject({ retrying: 1, published: 0 });
    const afterCrash = await prisma.videoRelease.findUniqueOrThrow({ where: { id: release.id } });
    expect(afterCrash).toMatchObject({ status: 'APPROVED', attempts: 1, error: 'provider exploded' });
    expect(afterCrash.nextAttemptAt).not.toBeNull();
    expect(await getWallet(user.id)).toMatchObject({ available: 10, reserved: 0 });

    // Before the backoff elapses nothing is retried.
    await runVideoReleases(realNow());
    expect(publish).toHaveBeenCalledTimes(1);

    const second = await runVideoReleases(new Date(Date.now() + 60 * 60_000));
    expect(second.published).toBe(1);
    expect(await prisma.videoRelease.findUniqueOrThrow({ where: { id: release.id } })).toMatchObject({
      status: 'PUBLISHED',
      externalId: 'yt-2',
      attempts: 2,
    });
    expect(await getWallet(user.id)).toMatchObject({ available: 8, reserved: 0 });
  });

  it('gives up after repeated retryable failures and refunds every attempt', async () => {
    const { user, release } = await seed();
    publish.mockResolvedValue({ ok: false, error: 'HTTP 503', retryable: true });
    for (const hours of [0, 2, 4, 6]) await runVideoReleases(new Date(Date.now() + hours * 3_600_000));
    expect(publish).toHaveBeenCalledTimes(3);
    expect(await prisma.videoRelease.findUniqueOrThrow({ where: { id: release.id } })).toMatchObject({
      status: 'FAILED',
      attempts: 3,
    });
    expect(await getWallet(user.id)).toMatchObject({ available: 10, reserved: 0 });
  });

  it('does not publish when the wallet cannot cover the slot', async () => {
    const { release } = await seed({ credits: 1 });
    const summary = await runVideoReleases(realNow());
    expect(summary.blocked).toBe(1);
    expect(publish).not.toHaveBeenCalled();
    expect((await prisma.videoRelease.findUniqueOrThrow({ where: { id: release.id } })).status).toBe('APPROVED');
  });
});

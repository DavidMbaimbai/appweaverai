import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '@/lib/crypto/secret-box';
import { getWallet, grantCredits } from '@/lib/marketing-credits/wallet';
import { makeProjectFor, makeUser, prisma } from '@/tests/integration/db';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn(async () => undefined) }));

import { publishDueProjectPosts, SENDERS } from './publish';

const originalX = SENDERS.X;
const now = new Date('2026-03-10T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

async function seed(opts: { credits?: number; connected?: boolean } = {}) {
  const user = await makeUser();
  const { project } = await makeProjectFor(user);
  if (opts.connected !== false) {
    await prisma.socialConnection.create({
      data: { userId: user.id, platform: 'X', accessTokenEnc: encryptSecret('x-token'), accountId: 'acct' },
    });
  }
  // Seeded price so the billable path (reserve -> settle/refund) is exercised.
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
  const campaign = await prisma.projectCampaign.create({ data: { projectId: project.id, userId: user.id, name: 'Spring' } });
  const post = await prisma.projectPost.create({
    data: {
      campaignId: campaign.id,
      platform: 'X',
      text: 'Hello world',
      hashtags: ['launch'],
      status: 'APPROVED',
      scheduledAt: minutesAgo(5),
    },
  });
  return { user, project, campaign, post };
}

describe('scheduled project post publishing (real Postgres, mocked X API)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    SENDERS.X = originalX;
  });

  it('persists a campaign with its posts and cascades on delete', async () => {
    const { campaign } = await seed();
    await prisma.projectPost.create({ data: { campaignId: campaign.id, platform: 'LINKEDIN', text: 'second' } });
    const loaded = await prisma.projectCampaign.findUniqueOrThrow({ where: { id: campaign.id }, include: { posts: true } });
    expect(loaded.posts).toHaveLength(2);
    expect(loaded.status).toBe('DRAFT');
    await prisma.projectCampaign.delete({ where: { id: campaign.id } });
    expect(await prisma.projectPost.count()).toBe(0);
  });

  it('publishes a due post, charges once, and a cron re-run does not publish again', async () => {
    const { user, post } = await seed();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'tweet-1' } }), { status: 201 }));

    const first = await publishDueProjectPosts(now);
    const second = await publishDueProjectPosts(now);
    const overlapping = await Promise.all([publishDueProjectPosts(now), publishDueProjectPosts(now)]);

    expect(first).toMatchObject({ published: 1, failed: 0 });
    expect(second.published).toBe(0);
    expect(overlapping.every((s) => s.published === 0)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saved = await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved).toMatchObject({ status: 'PUBLISHED', externalId: 'tweet-1' });
    expect(await getWallet(user.id)).toMatchObject({ available: 8, reserved: 0 });
    expect((await prisma.projectCampaign.findFirstOrThrow()).status).toBe('PUBLISHED');
  });

  it('runs concurrent cron invocations without double-publishing', async () => {
    const { post } = await seed();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'tweet-2' } }), { status: 201 }));
    const summaries = await Promise.all(Array.from({ length: 4 }, () => publishDueProjectPosts(now)));
    expect(summaries.reduce((n, s) => n + s.published, 0)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('PUBLISHED');
  });

  it('refunds the reservation and marks the post FAILED when the provider errors', async () => {
    const { user, post } = await seed();
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }));
    const summary = await publishDueProjectPosts(now);
    expect(summary).toMatchObject({ published: 0, failed: 1 });
    const saved = await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe('FAILED');
    expect(saved.error).toContain('429');
    expect(await getWallet(user.id)).toMatchObject({ available: 10, reserved: 0 });
  });

  it('refunds when the provider call throws', async () => {
    const { user, post } = await seed();
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await publishDueProjectPosts(now);
    expect((await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('FAILED');
    expect(await getWallet(user.id)).toMatchObject({ available: 10, reserved: 0 });
  });

  it('leaves the post queued and untouched when the wallet cannot cover it', async () => {
    const { user, post } = await seed({ credits: 1 });
    const summary = await publishDueProjectPosts(now);
    expect(summary.paused).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('APPROVED');
    expect(await getWallet(user.id)).toMatchObject({ available: 1, reserved: 0 });
  });

  it('retries a post whose media was still processing on the next cron run', async () => {
    const { user, post } = await seed();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'still processing', retry: true })
      .mockResolvedValueOnce({ ok: true, id: 'tweet-3' });
    SENDERS.X = send;

    await publishDueProjectPosts(now);
    expect((await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('SCHEDULED');
    expect(await getWallet(user.id)).toMatchObject({ available: 10, reserved: 0 });

    await publishDueProjectPosts(new Date(now.getTime() + 60_000));
    const saved = await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved).toMatchObject({ status: 'PUBLISHED', externalId: 'tweet-3' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await getWallet(user.id)).toMatchObject({ available: 8, reserved: 0 });
  });

  it('marks a post for manual posting when the account is not connected', async () => {
    const { post } = await seed({ connected: false });
    const summary = await publishDueProjectPosts(now);
    expect(summary.manual).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.projectPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('MANUAL');
  });
});

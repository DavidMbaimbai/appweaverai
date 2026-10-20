import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma } from '../../tests/integration/db';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

import { withMarketingCredits } from './run';
import {
  expireLots,
  getWallet,
  grantCredits,
  refundReservation,
  releaseReservation,
  releaseStaleReservations,
  reserveCredits,
  settleReservation,
} from './wallet';

async function invariant(userId: string) {
  const wallet = await getWallet(userId);
  const ledger = await prisma.marketingLedger.findMany({ where: { userId } });
  const delta = ledger.reduce((sum, r) => sum + r.delta, 0);
  const reserved = ledger.reduce((sum, r) => sum + r.reservedDelta, 0);
  expect(wallet.available).toBeGreaterThanOrEqual(0);
  expect(wallet.reserved).toBe(reserved);
  // available + reserved always equals what the immutable ledger says was granted minus what was spent.
  expect(wallet.available + wallet.reserved).toBe(delta);
  return wallet;
}

describe('marketing credit accounting (real PostgreSQL)', () => {
  let user: Awaited<ReturnType<typeof makeUser>>;
  let project: Awaited<ReturnType<typeof makeProjectFor>>['project'];

  beforeEach(async () => {
    user = await makeUser();
    ({ project } = await makeProjectFor(user));
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  });

  it('concurrent reservations never overdraw the wallet', async () => {
    await grantCredits({ userId: user.id, amount: 100, source: 'PURCHASED', idempotencyKey: 'g1' });
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        reserveCredits({ userId: user.id, operation: 'text_post', maxCredits: 10, idempotencyKey: `race:${i}` }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok)).toHaveLength(15);
    const wallet = await invariant(user.id);
    expect(wallet).toMatchObject({ available: 0, reserved: 100 });
  });

  it('concurrent first-ever reservations on an empty wallet fail cleanly (no crash, no negative balance)', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        reserveCredits({ userId: 'fresh-user', operation: 'text_post', maxCredits: 5, idempotencyKey: `fresh:${i}` }),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of results) {
      if (r.status === 'fulfilled') expect(r.value).toMatchObject({ ok: false, code: 'INSUFFICIENT_CREDITS' });
    }
    expect((await getWallet('fresh-user')).available).toBe(0);
  });

  it('idempotency keys make grants, reservations, settles and refunds one-shot', async () => {
    const first = await grantCredits({ userId: user.id, amount: 50, source: 'PROMO', idempotencyKey: 'grant-once' });
    const again = await grantCredits({ userId: user.id, amount: 50, source: 'PROMO', idempotencyKey: 'grant-once' });
    expect([first.granted, again.granted]).toEqual([true, false]);
    expect((await getWallet(user.id)).available).toBe(50);

    const parallel = await Promise.all(
      Array.from({ length: 6 }, () => reserveCredits({ userId: user.id, operation: 'text_post', maxCredits: 8, idempotencyKey: 'same-key' })),
    );
    expect(parallel.every((r) => r.ok)).toBe(true);
    expect(parallel.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(await prisma.marketingReservation.count()).toBe(1);
    expect(await getWallet(user.id)).toMatchObject({ available: 42, reserved: 8 });

    const settles = await Promise.all([1, 2, 3].map(() => settleReservation('same-key', 5)));
    expect(settles.filter((s) => s.settled)).toHaveLength(1);
    expect(await invariant(user.id)).toMatchObject({ available: 45, reserved: 0 });

    const refunds = await Promise.all([1, 2].map(() => refundReservation('same-key')));
    expect(refunds.filter((r) => r.refunded)).toHaveLength(1);
    expect(await invariant(user.id)).toMatchObject({ available: 50, reserved: 0 });
  });

  it('a settle racing a release resolves to exactly one outcome', async () => {
    await grantCredits({ userId: user.id, amount: 20, source: 'PURCHASED', idempotencyKey: 'g' });
    await reserveCredits({ userId: user.id, operation: 'text_post', maxCredits: 10, idempotencyKey: 'k' });
    const [settled, released] = await Promise.all([settleReservation('k', 10), releaseReservation('k')]);
    expect(Number(settled.settled) + Number(released)).toBe(1);
    const wallet = await invariant(user.id);
    expect(wallet.reserved).toBe(0);
    expect([10, 20]).toContain(wallet.available);
  });

  it('refunds the reservation when the work throws or reports failure', async () => {
    await grantCredits({ userId: user.id, amount: 30, source: 'PURCHASED', idempotencyKey: 'g' });
    await expect(
      withMarketingCredits({ userId: user.id, projectId: project.id, operation: 'text_post', idempotencyKey: 'job-throws' }, async () => {
        throw new Error('provider down');
      }),
    ).rejects.toThrow('provider down');
    expect(await invariant(user.id)).toMatchObject({ available: 30, reserved: 0 });

    const failed = await withMarketingCredits(
      { userId: user.id, projectId: project.id, operation: 'text_post', isFailure: (v: { ok: boolean }) => !v.ok },
      async () => ({ ok: false }),
    );
    expect(failed).toMatchObject({ ok: true, charged: 0 });
    expect(await invariant(user.id)).toMatchObject({ available: 30, reserved: 0 });

    const success = await withMarketingCredits({ userId: user.id, projectId: project.id, operation: 'text_post' }, async () => 'done');
    expect(success).toMatchObject({ ok: true, charged: 3, billing: 'CUSTOMER_MARKETING' });
    expect(await invariant(user.id)).toMatchObject({ available: 27, reserved: 0 });

    const kinds = (await prisma.marketingLedger.findMany({ orderBy: { createdAt: 'asc' } })).map((r) => r.kind);
    expect(kinds).toContain('RELEASE');
    expect(kinds.filter((k) => k === 'SETTLE')).toHaveLength(1);
  });

  it('does not run the work at all when the wallet cannot cover it', async () => {
    const work = vi.fn(async () => 'x');
    const outcome = await withMarketingCredits({ userId: user.id, projectId: project.id, operation: 'campaign_draft' }, work);
    expect(outcome).toMatchObject({ ok: false, reason: 'insufficient', insufficient: true });
    expect(work).not.toHaveBeenCalled();
  });

  it('refuses a duplicate submission with the same idempotency key', async () => {
    await grantCredits({ userId: user.id, amount: 30, source: 'PURCHASED', idempotencyKey: 'g' });
    const work = vi.fn(async () => 'x');
    const opts = { userId: user.id, projectId: project.id, operation: 'text_post' as const, idempotencyKey: 'submit-1' };
    const results = await Promise.all([withMarketingCredits(opts, work), withMarketingCredits(opts, work)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(await invariant(user.id)).toMatchObject({ available: 27 });
  });

  it('internal campaigns charge zero customer credits and only log house cost', async () => {
    const admin = await makeUser({ adminRole: 'SUPER_ADMIN' });
    process.env.PLATFORM_ADMIN_USER_IDS = admin.id;
    await grantCredits({ userId: admin.id, amount: 40, source: 'PURCHASED', idempotencyKey: 'admin-grant' });
    const outcome = await withMarketingCredits({ userId: admin.id, operation: 'campaign_draft' }, async () => 'ok');
    expect(outcome).toMatchObject({ ok: true, charged: 0, billing: 'APPWEAVER_INTERNAL' });
    expect(await getWallet(admin.id)).toMatchObject({ available: 40, reserved: 0 });
    expect(await prisma.marketingReservation.count()).toBe(0);
    const costs = await prisma.internalMarketingCost.findMany();
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ billing: 'APPWEAVER_INTERNAL', operation: 'campaign_draft', adminId: admin.id });
  });

  it('ignores a client-supplied "internal" flag from customers and non-platform admins', async () => {
    await grantCredits({ userId: user.id, amount: 30, source: 'PURCHASED', idempotencyKey: 'g' });
    const work = vi.fn(async () => 'x');
    const spoof = await withMarketingCredits(
      { userId: user.id, projectId: project.id, operation: 'text_post', claimedBilling: 'APPWEAVER_INTERNAL' },
      work,
    );
    expect(spoof).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(work).not.toHaveBeenCalled();

    // An admin who is not a listed platform account is still a customer.
    const admin = await makeUser({ adminRole: 'ADMIN' });
    await grantCredits({ userId: admin.id, amount: 30, source: 'PURCHASED', idempotencyKey: 'ag' });
    const adminSpoof = await withMarketingCredits({ userId: admin.id, operation: 'text_post', claimedBilling: 'APPWEAVER_INTERNAL' }, work);
    expect(adminSpoof).toMatchObject({ ok: false, reason: 'forbidden' });
    const adminPlain = await withMarketingCredits({ userId: admin.id, operation: 'text_post' }, work);
    expect(adminPlain).toMatchObject({ ok: true, charged: 3, billing: 'CUSTOMER_MARKETING' });
    expect(await prisma.internalMarketingCost.count()).toBe(0);
  });

  it('enforces org suspension, project budgets and pauses scheduled jobs', async () => {
    await grantCredits({ userId: user.id, amount: 100, source: 'PURCHASED', idempotencyKey: 'g' });
    await prisma.marketingProjectBudget.create({ data: { projectId: project.id, dayLimit: 5 } });
    const work = vi.fn(async () => 'x');
    expect(await withMarketingCredits({ userId: user.id, projectId: project.id, operation: 'text_post' }, work)).toMatchObject({ ok: true });
    const over = await withMarketingCredits({ userId: user.id, projectId: project.id, operation: 'text_post', scheduled: true }, work);
    expect(over).toMatchObject({ ok: false, reason: 'budget' });
    expect((await prisma.marketingProjectBudget.findUnique({ where: { projectId: project.id } }))?.pausedAt).not.toBeNull();

    const workspaceId = (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).workspaceId;
    await prisma.marketingOrgControl.create({ data: { orgId: workspaceId, suspendedAt: new Date(), suspendedReason: 'abuse' } });
    expect(await withMarketingCredits({ userId: user.id, projectId: project.id, operation: 'image' }, work)).toMatchObject({ ok: false, reason: 'suspended' });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('releases stale reservations and expires unspent promo lots', async () => {
    await grantCredits({ userId: user.id, amount: 20, source: 'PROMO', idempotencyKey: 'promo', expiresAt: new Date(Date.now() - 1000) });
    await reserveCredits({ userId: user.id, operation: 'text_post', maxCredits: 5, idempotencyKey: 'stale', ttlMs: 1 });
    expect(await releaseStaleReservations(new Date(Date.now() + 60_000))).toBe(1);
    expect(await invariant(user.id)).toMatchObject({ available: 20, reserved: 0 });
    expect(await expireLots()).toBe(20);
    expect(await invariant(user.id)).toMatchObject({ available: 0, reserved: 0 });
    expect(await expireLots()).toBe(0);
  });
});

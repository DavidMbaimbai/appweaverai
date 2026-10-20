import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma, uid } from '@/tests/integration/db';

const session = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/cached', () => ({
  getCachedSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));

import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  listConnectionsAction,
  testIntegrationAction,
} from '@/lib/actions/integrations';
import { createInboundEndpoint, receiveInboundWebhook, signatureHeader } from '@/lib/integrations/webhooks';

const SECRET_KEY = 'sk_test_PLAINTEXTSECRET0001';

async function seed() {
  const user = await makeUser();
  const { project } = await makeProjectFor(user);
  return { user, project };
}

describe('integrations (real Postgres)', () => {
  let a: Awaited<ReturnType<typeof seed>>;
  let b: Awaited<ReturnType<typeof seed>>;

  beforeEach(async () => {
    process.env.BETTER_AUTH_SECRET ||= 'integration-test-secret-integration-test-secret';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ object: 'balance' }), { status: 200 })));
    a = await seed();
    b = await seed();
    session.userId = a.user.id;
  });

  it('stores the secret encrypted, injects env vars, and never returns the secret', async () => {
    const res = await connectIntegrationAction(a.project.id, 'stripe', { secretKey: SECRET_KEY });
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.test.ok).toBe(true);
    expect(JSON.stringify(res)).not.toContain(SECRET_KEY);
    expect(res.connection.maskedHints.secretKey).toBe('••••0001');

    const row = await prisma.integrationConnection.findFirstOrThrow({ where: { projectId: a.project.id } });
    expect(row.secretEnc).not.toContain(SECRET_KEY);
    const envs = await prisma.projectSecret.findMany({ where: { projectId: a.project.id, key: 'STRIPE_SECRET_KEY' } });
    expect(envs).toHaveLength(3);
    expect(envs.every((e) => !e.value.includes(SECRET_KEY))).toBe(true);
    expect(await prisma.integrationHealthCheck.count({ where: { connectionId: row.id } })).toBeGreaterThan(0);

    const listed = await listConnectionsAction(a.project.id);
    expect(JSON.stringify(listed)).not.toContain(SECRET_KEY);

    const gone = await disconnectIntegrationAction(a.project.id, 'stripe');
    expect('error' in gone).toBe(false);
    expect(await prisma.integrationConnection.count({ where: { projectId: a.project.id } })).toBe(0);
    expect(await prisma.projectSecret.count({ where: { projectId: a.project.id, key: 'STRIPE_SECRET_KEY' } })).toBe(0);
  });

  it('records a failed test without leaking the key', async () => {
    await connectIntegrationAction(a.project.id, 'stripe', { secretKey: SECRET_KEY });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const res = await testIntegrationAction(a.project.id, 'stripe');
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.ok).toBe(false);
    const row = await prisma.integrationConnection.findFirstOrThrow({ where: { projectId: a.project.id } });
    expect(row.lastTestOk).toBe(false);
    expect(row.lastTestError ?? '').not.toContain(SECRET_KEY);
  });

  it('isolates tenants: another user cannot list, connect, test or disconnect', async () => {
    await connectIntegrationAction(a.project.id, 'stripe', { secretKey: SECRET_KEY });
    session.userId = b.user.id;

    for (const result of [
      await listConnectionsAction(a.project.id),
      await connectIntegrationAction(a.project.id, 'stripe', { secretKey: 'sk_test_ATTACKERKEY0002' }),
      await testIntegrationAction(a.project.id, 'stripe'),
      await disconnectIntegrationAction(a.project.id, 'stripe'),
    ]) {
      expect('error' in result).toBe(true);
    }

    const row = await prisma.integrationConnection.findFirstOrThrow({ where: { projectId: a.project.id } });
    expect(row.status).not.toBe('DISCONNECTED');
    expect(await prisma.integrationConnection.count({ where: { projectId: b.project.id } })).toBe(0);
  });

  it('rejects invalid credentials before storing anything', async () => {
    const res = await connectIntegrationAction(a.project.id, 'stripe', { secretKey: 'pk_live_notasecretkey123' });
    expect('error' in res).toBe(true);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  it('inbound webhooks: verifies signatures, dedupes event ids, rejects replays', async () => {
    const created = await createInboundEndpoint(a.project.id, 'orders');
    if (!created.ok) throw new Error('endpoint not created');
    const body = JSON.stringify({ n: 1 });
    const now = Math.floor(Date.now() / 1000);
    const send = (id: string | null, ts: number, secret = created.secret, nowSeconds = now) =>
      receiveInboundWebhook({
        publicId: created.endpoint.publicId,
        body,
        headers: { id, timestamp: String(ts), signature: signatureHeader(secret, ts, body) },
        nowSeconds,
      });

    const evt = uid('evt');
    expect(await send(evt, now)).toEqual({ status: 200, duplicate: false });
    expect(await send(evt, now)).toEqual({ status: 200, duplicate: true });
    expect((await send(uid('evt'), now, 'whsec_wrong')).status).toBe(401);
    expect((await send(uid('evt'), now - 1000)).status).toBe(401);
    expect((await send(null, now)).status).toBe(400);
    expect(await prisma.inboundWebhookEvent.count({ where: { endpointId: created.endpoint.id } })).toBe(1);

    const unknown = await receiveInboundWebhook({ publicId: 'nope', body, headers: { id: evt, timestamp: String(now), signature: 'v1=00' } });
    expect(unknown.status).toBe(404);
  });
});

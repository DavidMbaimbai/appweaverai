import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBillingContext, BillingClassificationError } from '@/lib/marketing-credits/billing-class';
import { getWallet, grantCredits } from '@/lib/marketing-credits/wallet';
import { withMarketingCredits } from '@/lib/marketing-credits/run';
import { makeProjectFor, makeUser, prisma, uid } from '@/tests/integration/db';

import { hasProjectAccess, projectAccessWhere, projectOwnerAccessOr } from './access';

const session = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) } },
}));
vi.mock('@/lib/auth/cached', () => ({
  getCachedSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));

import { GET as calendarStatusGET } from '@/app/api/projects/[projectId]/calendar/route';
import { POST as agentPOST } from '@/app/api/projects/[projectId]/agent/route';
import { saveProjectBudgetAction } from '@/lib/actions/marketing-credits';

async function seedTenant(label: string) {
  const user = await makeUser();
  const { workspace, project } = await makeProjectFor(user);
  const lead = await prisma.lead.create({ data: { projectId: project.id, name: `${label} lead`, email: `${uid(label)}@example.com` } });
  const conversation = await prisma.conversation.create({
    data: { scopeType: 'PROJECT', scopeId: project.id, channel: 'WEBCHAT', externalThreadId: uid('t'), contactRef: uid('c'), leadId: lead.id },
  });
  await prisma.inboxMessage.create({ data: { conversationId: conversation.id, channel: 'WEBCHAT', direction: 'INBOUND', body: `${label} secret message` } });
  const agentConversation = await prisma.agentConversation.create({ data: { projectId: project.id, userId: user.id, title: label } });
  await prisma.agentMessage.create({ data: { conversationId: agentConversation.id, role: 'USER', content: `${label} private prompt` } });
  const asset = await prisma.mediaAsset.create({
    data: { scopeKey: project.id, projectId: project.id, kind: 'IMAGE', key: `media/${uid('k')}.png`, contentType: 'image/png', sizeBytes: 10, sha256: 'a'.repeat(64) },
  });
  await prisma.calendarConnection.create({ data: { scopeKey: project.id, ownerId: user.id, provider: 'GOOGLE', status: 'CONNECTED' } });
  const meeting = await prisma.meeting.create({
    data: { scopeType: 'PROJECT', scopeId: project.id, title: `${label} meeting`, requestedById: user.id, idempotencyKey: uid('m') },
  });
  await prisma.projectSecret.create({ data: { projectId: project.id, key: 'API_KEY', value: `enc:${label}`, environment: 'DEVELOPMENT' } });
  await prisma.agentSetting.create({ data: { scopeType: 'PROJECT', scopeId: project.id, agent: 'CONTENT', enabled: true } });
  await grantCredits({ userId: user.id, amount: 40, source: 'PURCHASED', idempotencyKey: uid('grant') });
  return { user, workspace, project, lead, conversation, agentConversation, asset, meeting };
}

function budgetForm() {
  const form = new FormData();
  form.set('dayLimit', '1');
  form.set('weekLimit', '2');
  form.set('monthLimit', '3');
  return form;
}

describe('tenant isolation (real Postgres, real handlers)', () => {
  let a: Awaited<ReturnType<typeof seedTenant>>;
  let b: Awaited<ReturnType<typeof seedTenant>>;

  beforeEach(async () => {
    a = await seedTenant('a');
    b = await seedTenant('b');
    session.userId = a.user.id;
  });

  it('access helpers never expose B resources to A (and vice versa)', async () => {
    expect(await hasProjectAccess(b.project.id, a.user.id)).toBe(false);
    expect(await hasProjectAccess(a.project.id, b.user.id)).toBe(false);
    const visibleToA = await prisma.project.findMany({ where: projectAccessWhere(a.user.id), select: { id: true } });
    expect(visibleToA.map((p) => p.id)).toEqual([a.project.id]);
    const ownedByA = await prisma.project.findMany({ where: { OR: projectOwnerAccessOr(a.user.id) }, select: { id: true } });
    expect(ownedByA.map((p) => p.id)).toEqual([a.project.id]);
  });

  it("A cannot spend B's wallet and B's wallet and ledger are untouched", async () => {
    const work = vi.fn(async () => 'x');
    const outcome = await withMarketingCredits({ userId: a.user.id, projectId: b.project.id, operation: 'text_post' }, work);
    expect(outcome).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(work).not.toHaveBeenCalled();
    expect(await getWallet(b.user.id)).toMatchObject({ available: 40, reserved: 0 });
    expect(await prisma.marketingLedger.count({ where: { projectId: b.project.id } })).toBe(0);
  });

  it("A cannot classify billing against or set the budget of B's project", async () => {
    await expect(resolveBillingContext({ userId: a.user.id, projectId: b.project.id })).rejects.toBeInstanceOf(BillingClassificationError);
    const result = await saveProjectBudgetAction(b.project.id, budgetForm());
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(await prisma.marketingProjectBudget.count({ where: { projectId: b.project.id } })).toBe(0);
    expect(await saveProjectBudgetAction(a.project.id, budgetForm())).toMatchObject({ ok: true });
  });

  it('a creator removed from the workspace loses owner-level and billing access', async () => {
    const creator = await makeUser();
    await prisma.workspaceMember.create({ data: { workspaceId: a.workspace.id, userId: creator.id } });
    const project = await prisma.project.create({
      data: { workspaceId: a.workspace.id, name: 'Created', slug: uid('p'), createdById: creator.id },
    });
    session.userId = creator.id;
    expect((await calendarStatusGET(new Request('http://x'), { params: Promise.resolve({ projectId: project.id }) })).status).toBe(200);

    await prisma.workspaceMember.deleteMany({ where: { userId: creator.id } });
    expect((await calendarStatusGET(new Request('http://x'), { params: Promise.resolve({ projectId: project.id }) })).status).toBe(404);
    expect(await hasProjectAccess(project.id, creator.id)).toBe(false);
    expect(await saveProjectBudgetAction(project.id, budgetForm())).toMatchObject({ error: expect.any(String) });
    await expect(resolveBillingContext({ userId: creator.id, projectId: project.id })).rejects.toBeInstanceOf(BillingClassificationError);
  });

  it("the calendar route hides B's connection from A and requires a session", async () => {
    const res = await calendarStatusGET(new Request('http://x'), { params: Promise.resolve({ projectId: b.project.id }) });
    expect(res.status).toBe(404);
    session.userId = null;
    const anon = await calendarStatusGET(new Request('http://x'), { params: Promise.resolve({ projectId: a.project.id }) });
    expect(anon.status).toBe(401);
  });

  it("the agent route refuses B's project and B's conversationId", async () => {
    const artifact = await prisma.artifact.create({ data: { projectId: a.project.id, type: 'WEB_APP', name: 'n', slug: 's' } as never });
    const call = (projectId: string, body: object) =>
      agentPOST(
        new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
        { params: Promise.resolve({ projectId }) },
      );

    expect((await call(b.project.id, { content: 'hi', artifactId: artifact.id })).status).toBe(404);
    const crossConversation = await call(a.project.id, { content: 'hi', artifactId: artifact.id, conversationId: b.agentConversation.id });
    expect(crossConversation.status).toBe(404);
    expect(await prisma.agentMessage.count({ where: { conversationId: b.agentConversation.id } })).toBe(1);

    session.userId = null;
    expect((await call(a.project.id, { content: 'hi', artifactId: artifact.id })).status).toBe(401);
  });

  it('per-project data stays partitioned by project scope', async () => {
    expect(await prisma.lead.count({ where: { projectId: a.project.id } })).toBe(1);
    const inboxA = await prisma.conversation.findMany({ where: { scopeType: 'PROJECT', scopeId: a.project.id }, include: { messages: true } });
    expect(inboxA.flatMap((c) => c.messages.map((m) => m.body))).toEqual(['a secret message']);
    expect(await prisma.mediaAsset.findFirst({ where: { id: b.asset.id, scopeKey: a.project.id } })).toBeNull();
    expect(await prisma.meeting.findFirst({ where: { id: b.meeting.id, scopeId: a.project.id } })).toBeNull();
    expect(await prisma.projectSecret.count({ where: { projectId: a.project.id } })).toBe(1);
    const settingsA = await prisma.agentSetting.findMany({ where: { scopeType: 'PROJECT', scopeId: a.project.id } });
    expect(settingsA).toHaveLength(1);
    expect(settingsA[0].scopeId).toBe(a.project.id);
  });
});

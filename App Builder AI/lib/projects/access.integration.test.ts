import { describe, expect, it, vi } from 'vitest';

import { getProjectConnectionFields, saveProjectConnection } from '@/lib/messaging/connections';
import { getWallet, grantCredits } from '@/lib/marketing-credits/wallet';
import { withMarketingCredits } from '@/lib/marketing-credits/run';
import { ensurePublishableMedia } from '@/lib/media-hosting/urls';
import { makeProjectFor, makeUser, prisma } from '@/tests/integration/db';

import { getAccessibleProject, hasProjectAccess } from './access';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

describe('workspace access control (real Postgres)', () => {
  it('limits projects to the owner and workspace members', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const member = await makeUser();
    const { workspace, project } = await makeProjectFor(a);
    const other = await makeProjectFor(b);

    expect(await hasProjectAccess(project.id, a.id)).toBe(true);
    expect(await hasProjectAccess(project.id, b.id)).toBe(false);
    expect(await hasProjectAccess(other.project.id, a.id)).toBe(false);
    expect(await getAccessibleProject(project.id, b.id, { id: true })).toBeNull();

    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id } });
    expect(await hasProjectAccess(project.id, member.id)).toBe(true);
    expect(await hasProjectAccess(other.project.id, member.id)).toBe(false);

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    expect(await hasProjectAccess(project.id, a.id)).toBe(false);
    expect(await hasProjectAccess(project.id, a.id, { includeTrashed: true })).toBe(true);
  });

  it("never lets user A spend user B's wallet through B's project", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { project: projectB } = await makeProjectFor(b);
    await grantCredits({ userId: b.id, amount: 50, source: 'PURCHASED', idempotencyKey: 'b-grant' });
    await grantCredits({ userId: a.id, amount: 50, source: 'PURCHASED', idempotencyKey: 'a-grant' });

    const work = vi.fn(async () => 'spent');
    const outcome = await withMarketingCredits({ userId: a.id, projectId: projectB.id, operation: 'text_post' }, work);
    expect(outcome).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(work).not.toHaveBeenCalled();
    expect(await getWallet(b.id)).toMatchObject({ available: 50, reserved: 0 });
    expect(await getWallet(a.id)).toMatchObject({ available: 50, reserved: 0 });
    expect(await prisma.marketingReservation.count()).toBe(0);
  });

  it('bills a workspace member against the workspace owner wallet only for that workspace', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const { workspace, project } = await makeProjectFor(owner);
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id } });
    await grantCredits({ userId: owner.id, amount: 20, source: 'PURCHASED', idempotencyKey: 'o' });

    const outcome = await withMarketingCredits({ userId: member.id, projectId: project.id, operation: 'text_post' }, async () => 'ok');
    expect(outcome).toMatchObject({ ok: true, charged: 3 });
    expect(await getWallet(owner.id)).toMatchObject({ available: 17 });
    expect((await getWallet(member.id)).available).toBe(0);
  });

  it("keeps one project's media and channel credentials invisible to another project", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { project: projectA } = await makeProjectFor(a);
    const { project: projectB } = await makeProjectFor(b);
    await saveProjectConnection(projectB.id, 'WHATSAPP', { accessToken: 'secret-b', phoneNumberId: '111' });

    expect(await getProjectConnectionFields(projectA.id, 'WHATSAPP')).toBeNull();
    expect(await getProjectConnectionFields(projectB.id, 'WHATSAPP')).toMatchObject({ accessToken: 'secret-b' });
    const stored = await prisma.channelConnection.findFirstOrThrow({ where: { scopeId: projectB.id } });
    expect(stored.config).not.toContain('secret-b');

    const asset = await prisma.mediaAsset.create({
      data: {
        scopeKey: projectB.id,
        projectId: projectB.id,
        kind: 'IMAGE',
        key: 'media/private/p-b/x.png',
        contentType: 'image/png',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    });
    expect(await ensurePublishableMedia(asset.id, { maxBytes: 1000, scopeKey: projectA.id })).toMatchObject({
      ok: false,
      error: expect.stringContaining('different project'),
    });
  });
});

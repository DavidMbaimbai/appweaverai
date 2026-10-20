import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { grantCredits } from '@/lib/marketing-credits/wallet';

import { makeProjectFor, makeUser, prisma, sql } from './db';

describe('clean migration and schema constraints', () => {
  it('applied every migration in order on a clean database', async () => {
    const dirs = readdirSync(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const { rows } = await sql<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at, migration_name',
    );
    expect(rows.map((r) => r.migration_name)).toEqual(dirs);
    const tables = await sql(`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','marketing_ledger','media_assets','stripe_events')`);
    expect(tables.rowCount).toBe(4);
  });

  it('rejects UPDATE and DELETE on marketing_ledger rows (immutability trigger)', async () => {
    await grantCredits({ userId: 'u1', amount: 10, source: 'PROMO', idempotencyKey: 'schema:immutable' });
    await expect(sql(`UPDATE marketing_ledger SET delta = 999`)).rejects.toThrow(/immutable/);
    await expect(sql(`DELETE FROM marketing_ledger`)).rejects.toThrow(/immutable/);
    await expect(prisma.marketingLedger.updateMany({ data: { note: 'tamper' } })).rejects.toThrow(/immutable/);
    await expect(prisma.marketingLedger.deleteMany({})).rejects.toThrow(/immutable/);
    const rows = await prisma.marketingLedger.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(10);
  });

  it('enforces unique idempotency keys, stripe event ids and message ids', async () => {
    const data = { userId: 'u1', kind: 'GRANT' as const, delta: 1, balanceAfter: 1, idempotencyKey: 'dup' };
    await prisma.marketingLedger.create({ data });
    await expect(prisma.marketingLedger.create({ data })).rejects.toMatchObject({ code: 'P2002' });

    await prisma.stripeEvent.create({ data: { id: 'evt_1' } });
    await expect(prisma.stripeEvent.create({ data: { id: 'evt_1' } })).rejects.toMatchObject({ code: 'P2002' });

    const conv = await prisma.conversation.create({
      data: { scopeType: 'PLATFORM', scopeId: 'PLATFORM', channel: 'SMS', externalThreadId: '+1555', contactRef: '+1555' },
    });
    const msg = { conversationId: conv.id, channel: 'SMS' as const, direction: 'INBOUND' as const, body: 'hi', providerMessageId: 'SM1' };
    await prisma.inboxMessage.create({ data: msg });
    await expect(prisma.inboxMessage.create({ data: msg })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces unique members, foreign keys and cascades', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { workspace, project } = await makeProjectFor(owner);
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: other.id } });
    await expect(prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: other.id } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.project.create({ data: { workspaceId: 'missing', name: 'x', slug: 'x', createdById: owner.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.project.create({ data: { workspaceId: workspace.id, name: 'dup', slug: project.slug, createdById: owner.id } })).rejects.toMatchObject({ code: 'P2002' });

    await prisma.workspace.delete({ where: { id: workspace.id } });
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
    expect(await prisma.workspaceMember.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });

  it('truncation between tests leaves no rows behind', async () => {
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.marketingLedger.count()).toBe(0);
  });
});

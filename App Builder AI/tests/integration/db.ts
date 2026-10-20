import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import { prisma } from '@/lib/prisma';

import { assertSafeTestDatabaseUrl } from './guard';

export { prisma };

let pool: pg.Pool | undefined;

function rawPool() {
  if (!pool) {
    const url = inject('integrationDatabaseUrl');
    assertSafeTestDatabaseUrl(url);
    pool = new pg.Pool({ connectionString: url, max: 2 });
  }
  return pool;
}

export async function closeRawPool() {
  await pool?.end();
  pool = undefined;
}

/** Raw SQL against the throwaway database (constraint/trigger checks that bypass the app layer). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return rawPool().query<T>(text, params);
}

/** Empties every table (except Prisma's migration history) so each test starts from a clean slate. */
export async function resetDatabase() {
  const { rows } = await sql<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  await sql(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export const uid = (prefix = 'id') => `${prefix}_${randomBytes(6).toString('hex')}`;

export async function makeUser(overrides: { adminRole?: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | null; plan?: string; email?: string } = {}) {
  const id = uid('user');
  return prisma.user.create({
    data: {
      id,
      email: overrides.email ?? `${id}@example.test`,
      name: id,
      subscriptionPlan: overrides.plan ?? 'free',
      ...(overrides.adminRole ? { adminRole: overrides.adminRole } : {}),
    },
  });
}

/** A user with a personal workspace and one project in it. */
export async function makeProjectFor(owner: { id: string }) {
  const workspace = await prisma.workspace.create({
    data: { name: `ws ${owner.id}`, slug: uid('ws'), ownerId: owner.id },
  });
  const project = await prisma.project.create({
    data: { workspaceId: workspace.id, name: 'Test project', slug: uid('proj'), createdById: owner.id },
  });
  return { workspace, project };
}

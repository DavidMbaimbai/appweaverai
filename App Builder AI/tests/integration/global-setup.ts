import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';
import type { TestProject } from 'vitest/node';

import { adminUrl, assertSafeTestDatabaseUrl, databaseUrl, newThrowawayName, resolveServerUrl } from './guard';

declare module 'vitest' {
  export interface ProvidedContext {
    integrationDatabaseUrl: string;
  }
}

const root = process.cwd();
const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');

function prisma(args: string[], url: string) {
  // DATABASE_URL is set explicitly for the child so prisma.config.ts can never fall back to .env.local's database.
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

async function assertMigrationsAppliedInOrder(url: string) {
  const expected = readdirSync(path.join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at, migration_name',
    );
    const unfinished = rows.filter((r) => !r.finished_at || r.rolled_back_at);
    if (unfinished.length) throw new Error(`Migrations did not finish: ${unfinished.map((r) => r.migration_name).join(', ')}`);
    const applied = rows.map((r) => r.migration_name);
    if (JSON.stringify(applied) !== JSON.stringify(expected)) {
      throw new Error(`Migrations were not applied exactly in order.\napplied:  ${applied.join(',')}\nexpected: ${expected.join(',')}`);
    }
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  const server = resolveServerUrl();
  const name = newThrowawayName();
  const url = databaseUrl(server, name);
  assertSafeTestDatabaseUrl(url);

  const admin = new pg.Client({ connectionString: adminUrl(server) });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);

  const drop = async () => {
    assertSafeTestDatabaseUrl(url);
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  };

  try {
    const deploy = prisma(['migrate', 'deploy'], url);
    if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed on a clean database:\n${deploy.out}`);
    await assertMigrationsAppliedInOrder(url);

    const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], url);
    if (diff.status !== 0) throw new Error(`Schema drift: migrations do not match prisma/schema.prisma (exit ${diff.status}).\n${diff.out}`);
  } catch (error) {
    await drop();
    throw error;
  }

  project.provide('integrationDatabaseUrl', url);
  console.info(`[integration] throwaway database ${name} ready`);
  return async () => {
    await drop();
    console.info(`[integration] throwaway database ${name} dropped`);
  };
}

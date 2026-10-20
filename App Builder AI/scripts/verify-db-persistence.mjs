#!/usr/bin/env node
/**
 * Proves Postgres data survives a container restart.
 *
 * Creates a scratch database (appweaverai_it_persist_<random>) on the local server, applies every migration,
 * inserts a row, runs `docker restart <container>`, waits for the server, then checks that the schema (tables
 * and applied migrations) and the row are still there. The scratch database is always dropped afterwards.
 *
 * Safety: only localhost/127.0.0.1 servers, only databases named appweaverai_it_*, never reads DATABASE_URL.
 * Env: TEST_DATABASE_URL (server, default the local docker Postgres), POSTGRES_CONTAINER (default appweaverai-postgres).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.POSTGRES_CONTAINER?.trim() || 'appweaverai-postgres';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PREFIX = 'appweaverai_it_';

const server = new URL(process.env.TEST_DATABASE_URL?.trim() || 'postgresql://appweaverai:appweaverai@localhost:5432/postgres');
if (!LOCAL_HOSTS.has(server.hostname.toLowerCase())) {
  console.error(`Refusing to run: the server host must be localhost or 127.0.0.1 (got "${server.hostname}").`);
  process.exit(2);
}

const name = `${PREFIX}persist_${randomBytes(4).toString('hex')}`;
if (!/^[a-z0-9_]+$/.test(name) || !name.startsWith(PREFIX)) throw new Error(`Unsafe database name ${name}`);
const withDb = (db) => {
  const url = new URL(server.toString());
  url.pathname = `/${db}`;
  return url.toString();
};
const scratchUrl = withDb(name);

const log = (message) => console.log(`[persistence] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url, attempts = 1) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await sleep(1000);
    }
  }
  throw lastError;
}

async function snapshot(url, attempts = 1) {
  const client = await connect(url, attempts);
  try {
    const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    const migrations = await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at, migration_name');
    return { tables: tables.rows.map((r) => r.tablename), migrations: migrations.rows.map((r) => r.migration_name) };
  } finally {
    await client.end();
  }
}

let exitCode = 0;
let created = false;
try {
  const admin = await connect(withDb('postgres'));
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await admin.end();
  log(`created scratch database ${name}`);

  const deploy = spawnSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: scratchUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed:\n${deploy.stdout}${deploy.stderr}`);
  const expected = readdirSync(path.join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  log(`applied ${expected.length} migrations`);

  const probeId = `persist_${randomBytes(6).toString('hex')}`;
  const writer = await connect(scratchUrl);
  const inserted = await writer.query('INSERT INTO stripe_events (id) VALUES ($1) RETURNING created_at', [probeId]);
  await writer.end();
  const before = await snapshot(scratchUrl);
  if (JSON.stringify(before.migrations) !== JSON.stringify(expected)) throw new Error('Migrations were not applied in order before restart.');
  log(`inserted probe row ${probeId} (${before.tables.length} tables)`);

  log(`restarting container ${container} ...`);
  const restart = spawnSync('docker', ['restart', container], { encoding: 'utf8' });
  if (restart.status !== 0) throw new Error(`docker restart failed:\n${restart.stdout}${restart.stderr}`);

  const after = await snapshot(scratchUrl, 60);
  const reader = await connect(scratchUrl);
  const row = await reader.query('SELECT id, created_at FROM stripe_events WHERE id = $1', [probeId]);
  await reader.end();

  const problems = [];
  if (JSON.stringify(after.tables) !== JSON.stringify(before.tables)) problems.push('table list changed across the restart');
  if (JSON.stringify(after.migrations) !== JSON.stringify(expected)) problems.push('applied migrations changed across the restart');
  if (row.rowCount !== 1) problems.push('probe row is missing after the restart');
  else if (row.rows[0].created_at.getTime() !== inserted.rows[0].created_at.getTime()) problems.push('probe row changed across the restart');
  if (problems.length) throw new Error(problems.join('; '));
  log(`PASS: ${after.tables.length} tables, ${after.migrations.length} migrations and the probe row survived the restart`);
} catch (error) {
  exitCode = 1;
  console.error(`[persistence] FAIL: ${error instanceof Error ? error.message : error}`);
} finally {
  if (created) {
    try {
      const admin = await connect(withDb('postgres'), 60);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
      log(`dropped scratch database ${name}`);
    } catch (error) {
      exitCode = 1;
      console.error(`[persistence] could not drop ${name}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
process.exit(exitCode);

/**
 * Restore drill: restores a database dump into a throwaway local database, then verifies the restored row counts
 * against the counts recorded next to the dump. Proves backups are actually restorable.
 *
 *   npm run db:restore-drill                 -> latest dump in BACKUP_DIR (default ./backups)
 *   npm run db:restore-drill -- path.dump    -> a specific dump
 *   npm run db:restore-drill -- --self-source
 *        -> first builds a throwaway *source* database (migrations + sample rows), dumps it, then drills that dump.
 *           Use this to exercise the whole pipeline without touching any real database.
 *
 * Safety: only ever creates/drops databases named appweaverai_it_* on a localhost server (same guard as the
 * integration tests); it never reads DATABASE_URL. Set BACKUP_DOCKER_CONTAINER to run pg_dump/pg_restore via docker exec.
 * Optionally reports the result to BACKUP_REPORT_URL (POST, Bearer CRON_SECRET) so /admin/backups shows it.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { adminUrl, assertSafeTestDatabaseUrl, databaseUrl, resolveServerUrl } from '../tests/integration/guard';
import { compareRowCounts, totalRows, type RowCounts } from '../lib/backups/verify';

const root = process.cwd();
const backupDir = path.resolve(process.env.BACKUP_DIR || 'backups');
const container = process.env.BACKUP_DOCKER_CONTAINER;
const args = process.argv.slice(2);
const selfSource = args.includes('--self-source');
const explicitFile = args.find((a) => !a.startsWith('--'));

type Sidecar = { sizeBytes: number; rowCounts: { before: RowCounts; after: RowCounts }; sha256?: string };

function fail(message: string): never {
  throw new Error(message);
}

function newName(kind: 'drill' | 'src') {
  return `appweaverai_it_${kind}_${randomBytes(4).toString('hex')}`;
}

async function countRows(url: string): Promise<RowCounts> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const counts: RowCounts = {};
    for (const { tablename } of rows) {
      const res = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${tablename.replace(/"/g, '""')}"`);
      counts[tablename] = res.rows[0].n;
    }
    return counts;
  } finally {
    await client.end();
  }
}

function latestDump(): string {
  if (!existsSync(backupDir)) fail(`No backup directory at ${backupDir}. Run "npm run db:backup" or pass --self-source.`);
  const files = readdirSync(backupDir).filter((f) => f.endsWith('.dump')).sort();
  if (!files.length) fail(`No .dump files in ${backupDir}.`);
  return path.join(backupDir, files[files.length - 1]);
}

function restore(file: string, url: string) {
  assertSafeTestDatabaseUrl(url);
  const data = readFileSync(file);
  const restoreArgs = ['--no-owner', '--dbname', url];
  const result = container
    ? spawnSync('docker', ['exec', '-i', container, 'pg_restore', ...restoreArgs], { input: data, encoding: 'utf8', maxBuffer: 1 << 28 })
    : spawnSync('pg_restore', restoreArgs, { input: data, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) fail(`pg_restore could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`pg_restore failed:\n${result.stderr}`);
}

function prismaMigrateDeploy(url: string) {
  const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  if (result.status !== 0) fail(`prisma migrate deploy failed:\n${result.stdout}${result.stderr}`);
}

async function buildSelfSourceDump(admin: pg.Client, server: URL, created: string[]): Promise<string> {
  const name = newName('src');
  const url = databaseUrl(server, name);
  assertSafeTestDatabaseUrl(url);
  await admin.query(`CREATE DATABASE "${name}"`);
  created.push(name);
  prismaMigrateDeploy(url);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO backup_runs (id, kind, status, trigger, started_at, finished_at)
       SELECT 'drill-seed-' || g, 'BACKUP', 'SUCCESS', 'MANUAL', now(), now() FROM generate_series(1, 25) AS g`,
    );
  } finally {
    await client.end();
  }

  const before = new Set(existsSync(backupDir) ? readdirSync(backupDir) : []);
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'db-backup.mjs'), 'backup'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, BACKUP_DIR: backupDir },
  });
  if (run.status !== 0) fail(`backup of the throwaway source failed:\n${run.stdout}${run.stderr}`);
  const fresh = readdirSync(backupDir).filter((f) => f.endsWith('.dump') && !before.has(f)).sort();
  if (!fresh.length) fail('Self-source backup produced no dump.');
  return path.join(backupDir, fresh[fresh.length - 1]);
}

async function report(body: Record<string, unknown>) {
  const target = process.env.BACKUP_REPORT_URL?.trim();
  if (!target) return;
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`Reported drill result to ${new URL(target).host}: HTTP ${res.status}`);
  } catch (error) {
    console.error(`Could not report drill result: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  const startedAt = new Date();
  const server = resolveServerUrl();
  const admin = new pg.Client({ connectionString: adminUrl(server) });
  await admin.connect();
  const created: string[] = [];
  let dumpFile = explicitFile ?? '';
  let failure: string | null = null;
  let restoredCounts: RowCounts | undefined;

  try {
    if (selfSource) dumpFile = await buildSelfSourceDump(admin, server, created);
    else if (!dumpFile) dumpFile = latestDump();
    if (!existsSync(dumpFile)) fail(`Dump not found: ${dumpFile}`);

    const sidecarPath = `${dumpFile}.json`;
    if (!existsSync(sidecarPath)) fail(`Missing ${sidecarPath}; dumps made by "npm run db:backup" include it.`);
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar;

    const name = newName('drill');
    const url = databaseUrl(server, name);
    assertSafeTestDatabaseUrl(url);
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);

    console.log(`Restoring ${path.basename(dumpFile)} into throwaway database ${name} ...`);
    restore(dumpFile, url);
    restoredCounts = await countRows(url);

    const mismatches = compareRowCounts(sidecar.rowCounts.before, sidecar.rowCounts.after, restoredCounts);
    const missingMigrations = restoredCounts._prisma_migrations === undefined;
    if (totalRows(sidecar.rowCounts.after) === 0) fail('The dump contains no rows at all - refusing to call that a successful backup.');
    if (missingMigrations) fail('Restored database has no _prisma_migrations table.');
    if (mismatches.length) {
      fail(`Row count mismatches:\n${mismatches.map((m) => `  ${m.table}: expected ${m.expected.min}-${m.expected.max}, restored ${m.actual}`).join('\n')}`);
    }
    const tables = Object.keys(restoredCounts).length;
    console.log(`OK: ${tables} tables restored, ${totalRows(restoredCounts)} rows, all counts match the backup.`);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error(`DRILL FAILED: ${failure}`);
  } finally {
    for (const name of created) {
      // Names were generated here and re-checked by the guard; drop only those.
      assertSafeTestDatabaseUrl(databaseUrl(server, name));
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end();
    if (created.length) console.log(`Dropped throwaway database(s): ${created.join(', ')}`);
  }

  await report({
    kind: 'RESTORE_DRILL',
    status: failure ? 'FAILED' : 'SUCCESS',
    trigger: process.env.CI ? 'SCHEDULE' : 'MANUAL',
    location: dumpFile ? path.basename(dumpFile) : undefined,
    rowCounts: restoredCounts,
    error: failure ?? undefined,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  });
  process.exit(failure ? 1 : 0);
}

void main();

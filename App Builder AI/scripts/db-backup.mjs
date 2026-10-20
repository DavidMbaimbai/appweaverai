#!/usr/bin/env node
// Postgres backup / restore.
//   node scripts/db-backup.mjs backup            -> backups/appweaverai-<timestamp>.dump
//   node scripts/db-backup.mjs restore <file>    -> restores into DATABASE_URL (or RESTORE_DATABASE_URL)
// Uses pg_dump/pg_restore from PATH, or `docker exec` when BACKUP_DOCKER_CONTAINER
// is set (e.g. appweaverai-postgres). Keeps the newest BACKUP_KEEP (default 14) files.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

const [command, file] = process.argv.slice(2);
const dir = process.env.BACKUP_DIR || 'backups';
const container = process.env.BACKUP_DOCKER_CONTAINER;
const keep = Number(process.env.BACKUP_KEEP || 14);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'buffer', maxBuffer: 1 << 30, ...options });
  if (result.error) fail(`${cmd}: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} failed:\n${result.stderr?.toString()}`);
  return result.stdout;
}

/** Exact row count of every table in the public schema (used to verify restores). */
async function countRows(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const counts = {};
    for (const { tablename } of rows) {
      const res = await client.query(`SELECT count(*)::int AS n FROM "${tablename.replace(/"/g, '""')}"`);
      counts[tablename] = res.rows[0].n;
    }
    return counts;
  } finally {
    await client.end();
  }
}

if (command === 'backup') {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is required.');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(dir, `appweaverai-${stamp}.dump`);
  const startedAt = new Date().toISOString();
  const before = await countRows(url);
  const data = container
    ? run('docker', ['exec', container, 'pg_dump', '--format=custom', '--no-owner', url])
    : run('pg_dump', ['--format=custom', '--no-owner', url]);
  if (data.length < 100) fail('Backup looks empty; aborting.');
  const after = await countRows(url);
  writeFileSync(out, data);
  // Sidecar consumed by scripts/restore-drill.ts: counts before/after the dump bound what a faithful restore must contain.
  writeFileSync(
    `${out}.json`,
    JSON.stringify({
      file: path.basename(out),
      startedAt,
      finishedAt: new Date().toISOString(),
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      rowCounts: { before, after },
    }, null, 2),
  );
  console.log(`Backup written: ${out} (${data.length} bytes)`);

  const files = readdirSync(dir).filter((f) => f.endsWith('.dump')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(path.join(dir, old));
    rmSync(path.join(dir, `${old}.json`), { force: true });
  }
} else if (command === 'restore') {
  if (!file) fail('Usage: restore <file.dump>');
  const url = process.env.RESTORE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) fail('RESTORE_DATABASE_URL or DATABASE_URL is required.');
  const data = readFileSync(file);
  const args = ['--clean', '--if-exists', '--no-owner', '--dbname', url];
  if (container) {
    run('docker', ['exec', '-i', container, 'pg_restore', ...args], { input: data });
  } else {
    run('pg_restore', args, { input: data });
  }
  console.log(`Restored ${file}`);
} else {
  fail('Usage: node scripts/db-backup.mjs backup | restore <file>');
}

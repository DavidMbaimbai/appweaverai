// Read-only production inspection. Never print environment values or raw errors.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const keys = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TURNSTILE_SECRET_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY'];

async function inspect() {
  if (process.argv[2] !== '--child') {
    const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
    console.log(JSON.stringify({ processes: processes.filter(p => ['appweaverai', 'appweaverai-v2'].includes(p.name)).map(p => ({
      name: p.name, pid: p.pid, cwd: p.pm2_env.pm_cwd,
      executable: p.pm2_env.pm_exec_path, status: p.pm2_env.status,
    })) }));
    const target = processes.find(p => p.name === 'appweaverai-v2');
    if (!target) throw new Error('Target process missing');
    const env = Object.fromEntries(Object.entries({ ...target.pm2_env.env, ...target.pm2_env })
      .filter(([, value]) => typeof value === 'string'));
    env.NODE_ENV = 'production';
    const result = spawnSync(process.execPath, [process.argv[1], '--child', String(target.pm2_env.pm_uptime ?? '')], {
      cwd: target.pm2_env.pm_cwd, env, stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
    return;
  }

  const require = createRequire(resolve(process.cwd(), 'package.json'));
  const { loadEnvConfig } = require('@next/env');
  const { parse } = require('dotenv');
  const { Client } = require('pg');
  const inherited = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const { loadedEnvFiles } = loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const startedAt = Number(process.argv[3]);
  console.log(JSON.stringify({
    environmentInspection: 'Reconstructed from PM2 and current files, not read from the running Next.js process.',
    processStartedAt: startedAt > 0 ? new Date(startedAt).toISOString() : null,
    envFilesChangedAfterProcessStart: startedAt > 0
      ? loadedEnvFiles.filter(file => statSync(resolve(process.cwd(), file.path)).mtimeMs > startedAt).map(file => file.path)
      : null,
    warning: 'If files changed since startup, the database queried below may differ from the database used by the running app. Compare deployment history before drawing conclusions.',
  }));
  const previous = '/var/www/appweaverai/App Builder AI/.env';
  const previousEnv = existsSync(previous) ? parse(readFileSync(previous)) : {};
  console.log(JSON.stringify({ environment: keys.map(key => ({
    key, configured: Boolean(process.env[key]),
    source: inherited[key] !== undefined ? 'PM2' : loadedEnvFiles.find(file => key in (file.env ?? {}))?.path ?? 'unset',
    matchesPreviousBaseEnv: previousEnv[key] === undefined ? null : previousEnv[key] === process.env[key],
  })), publicAuthUrlCorrect: process.env.BETTER_AUTH_URL === 'https://appweaverai.com',
  captchaPairPresent: Boolean(process.env.TURNSTILE_SECRET_KEY) === Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  note: 'Previous .env comparison is not proof of the previous effective process environment. Google pair validity requires a real OAuth exchange.' }));

  if (!process.env.DATABASE_URL) throw new Error('Database URL missing');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const account = await client.query(`SELECT u.email_verified, a.provider_id,
      (a.password IS NOT NULL AND length(a.password) > 0) AS has_password
      FROM users u LEFT JOIN accounts a ON a.user_id = u.id WHERE lower(u.email) = $1`,
    ['admin@appweaverai.com']);
    console.log(JSON.stringify({ affectedAccountExists: account.rowCount > 0, providers: account.rows }));
    const migrations = await client.query('SELECT count(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    console.log(JSON.stringify({ migrations: migrations.rows[0] }));
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

inspect().catch(() => {
  console.error('Auth inspection failed. Check PM2 access, checkout dependencies and database availability locally; raw error suppressed to protect secrets.');
  process.exitCode = 1;
});

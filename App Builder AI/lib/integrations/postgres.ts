import { lookup } from 'node:dns/promises';

import { Client } from 'pg';

import type { TestResult } from './catalogue/types';
import { isBlockedIp } from './ssrf';

export type ParsedPostgresUrl = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/** Validates shape only (no network). Returns an error message for anything we refuse to connect to. */
export function parsePostgresUrl(raw: string): { ok: true; value: ParsedPostgresUrl } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Enter a valid postgres:// connection string.' };
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { ok: false, reason: 'Connection strings must start with postgres:// or postgresql://.' };
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Use a database host that is reachable from the public internet.' };
  }
  if (!url.username) return { ok: false, reason: 'The connection string must include a user.' };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'disable' || sslmode === 'allow' || sslmode === 'prefer') {
    return { ok: false, reason: 'TLS is required; remove sslmode or use sslmode=require.' };
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) return { ok: false, reason: 'The connection string must name a database.' };
  return {
    ok: true,
    value: {
      host: host.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : 5432,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    },
  };
}

/** Connects over TLS to a vetted public IP and runs a read-only query. */
export async function testPostgresConnection(connectionString: string): Promise<TestResult> {
  const parsed = parsePostgresUrl(connectionString);
  if (!parsed.ok) return { ok: false, message: parsed.reason };
  const { host, port, user, password, database } = parsed.value;

  let records;
  try {
    records = await lookup(host, { all: true });
  } catch {
    return { ok: false, message: 'The database host could not be resolved.' };
  }
  if (records.length === 0 || records.some((r) => isBlockedIp(r.address))) {
    return { ok: false, message: 'The database host resolves to a private or local address, which is not allowed.' };
  }

  const client = new Client({
    host: records[0].address,
    port,
    user,
    password,
    database,
    ssl: { servername: host },
    connectionTimeoutMillis: 8_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query('SELECT 1');
    await client.query('ROLLBACK');
    return { ok: true, message: 'Connected over TLS and ran a read-only query.' };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '28P01' || code === '28000') return { ok: false, message: 'The database rejected the username or password.' };
    if (code === '3D000') return { ok: false, message: 'The database does not exist.' };
    return { ok: false, message: 'Could not connect. Check the host, port, TLS and any IP allow-list.' };
  } finally {
    await client.end().catch(() => undefined);
  }
}

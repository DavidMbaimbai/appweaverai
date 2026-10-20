import { randomBytes } from 'node:crypto';

/**
 * Safety rails for the integration suite. The suite only ever creates, uses and drops a
 * throwaway database, and refuses anything that could be a real environment. It never
 * reads DATABASE_URL.
 */

export const THROWAWAY_PREFIX = 'appweaverai_it_';
export const DEFAULT_TEST_SERVER_URL = 'postgresql://appweaverai:appweaverai@localhost:5432/postgres';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isSafeTestDatabaseName(name: string) {
  return /^[a-z0-9_]+$/.test(name) && (name.startsWith(THROWAWAY_PREFIX) || name.endsWith('_test'));
}

export function isLocalHost(host: string) {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

export function newThrowawayName() {
  return `${THROWAWAY_PREFIX}${randomBytes(5).toString('hex')}`;
}

/** The server the throwaway database is created on (TEST_DATABASE_URL, default: the local docker Postgres). */
export function resolveServerUrl(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_SERVER_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection string.');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('TEST_DATABASE_URL must be a postgres:// URL.');
  if (!isLocalHost(url.hostname)) {
    throw new Error(`Refusing to run: the test server host must be localhost or 127.0.0.1 (got "${url.hostname}").`);
  }
  return url;
}

/** Connection URL for one database on the server; throws unless the name is a safe test name. */
export function databaseUrl(server: URL, name: string) {
  if (!isSafeTestDatabaseName(name)) {
    throw new Error(`Refusing to use database "${name}": test databases must start with ${THROWAWAY_PREFIX} or end with _test.`);
  }
  if (!isLocalHost(server.hostname)) throw new Error('Refusing to run against a non-local host.');
  const url = new URL(server.toString());
  url.pathname = `/${name}`;
  return url.toString();
}

/** Same server, maintenance database - used only for CREATE/DROP DATABASE of a safe name. */
export function adminUrl(server: URL) {
  const url = new URL(server.toString());
  url.pathname = '/postgres';
  return url.toString();
}

/** Throws unless this URL points at a local, safely named test database. */
export function assertSafeTestDatabaseUrl(raw: string) {
  const url = new URL(raw);
  if (!isLocalHost(url.hostname)) throw new Error(`Refusing to run: host "${url.hostname}" is not local.`);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!isSafeTestDatabaseName(name)) {
    throw new Error(`Refusing to run: database "${name}" is not a test database (must start with ${THROWAWAY_PREFIX} or end with _test).`);
  }
}

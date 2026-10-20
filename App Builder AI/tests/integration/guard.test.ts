import { describe, expect, it } from 'vitest';

import {
  adminUrl,
  assertSafeTestDatabaseUrl,
  databaseUrl,
  isSafeTestDatabaseName,
  newThrowawayName,
  resolveServerUrl,
} from './guard';

describe('integration database guard', () => {
  it('only accepts throwaway or *_test names', () => {
    expect(isSafeTestDatabaseName(newThrowawayName())).toBe(true);
    expect(isSafeTestDatabaseName('ci_test')).toBe(true);
    for (const bad of ['appweaverai', 'postgres', 'production', 'appweaverai_it', 'x; DROP DATABASE appweaverai', '']) {
      expect(isSafeTestDatabaseName(bad)).toBe(false);
    }
  });

  it('refuses non-local servers and non-test databases', () => {
    expect(() => resolveServerUrl({ NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://u:p@db.prod.example.com:5432/postgres' })).toThrow(/localhost/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5432/appweaverai')).toThrow(/not a test database/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u:p@prod.example.com:5432/appweaverai_it_abc')).toThrow(/not local/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u:p@127.0.0.1:5432/appweaverai_it_abc')).not.toThrow();
  });

  it('never targets the app database and ignores DATABASE_URL', () => {
    const server = resolveServerUrl({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@prod.example.com/appweaverai' } as NodeJS.ProcessEnv);
    expect(server.hostname).toBe('localhost');
    expect(new URL(adminUrl(server)).pathname).toBe('/postgres');
    expect(() => databaseUrl(server, 'appweaverai')).toThrow(/Refusing/);
  });
});

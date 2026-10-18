import { describe, expect, it } from 'vitest';

import { connectionEnvFromUrl, databaseIdentifier } from './provision';

describe('databaseIdentifier', () => {
  it('builds a safe lowercase name per environment', () => {
    expect(databaseIdentifier('Cm-Abc_123', 'DEVELOPMENT')).toBe('aw_cmabc123_dev');
    expect(databaseIdentifier('cmabc123', 'PRODUCTION')).toBe('aw_cmabc123_prod');
  });

  it('rejects ids that cannot form an identifier', () => {
    expect(() => databaseIdentifier('---', 'DEVELOPMENT')).toThrow();
  });
});

describe('connectionEnvFromUrl', () => {
  it('derives JDBC, username and password', () => {
    const env = connectionEnvFromUrl(
      'postgresql://aw_x_dev:p%40ss@db.example.com:5432/aw_x_dev?sslmode=require',
    );
    expect(env.DATABASE_JDBC_URL).toBe(
      'jdbc:postgresql://db.example.com:5432/aw_x_dev?sslmode=require',
    );
    expect(env.DATABASE_USERNAME).toBe('aw_x_dev');
    expect(env.DATABASE_PASSWORD).toBe('p@ss');
  });
});

import { describe, expect, it } from 'vitest';

import { buildAuthHeaders, filterCallerHeaders, parseConnectorConfig, resolveConnectorUrl } from './connector';
import { parsePostgresUrl } from './postgres';
import { createGuardedLookup, createSafeFetch, isBlockedIp, SsrfError, validateOutboundUrl } from './ssrf';

describe('validateOutboundUrl', () => {
  it.each([
    'http://example.com/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://user:pw@example.com/',
    'https://example.com:8080/',
    'file:///etc/passwd',
    'not a url',
  ])('rejects %s', (url) => {
    expect(validateOutboundUrl(url).ok).toBe(false);
  });

  it('accepts public https hosts', () => {
    expect(validateOutboundUrl('https://api.example.com/v1').ok).toBe(true);
    expect(validateOutboundUrl('https://api.example.com:8443/v1').ok).toBe(true);
  });
});

describe('isBlockedIp', () => {
  it.each(['10.0.0.1', '192.168.1.1', '172.16.0.1', '127.0.0.1', '169.254.169.254', '::1', '198.18.0.1', '::ffff:7f00:1'])(
    'blocks %s',
    (ip) => expect(isBlockedIp(ip)).toBe(true),
  );
  it('allows public addresses', () => expect(isBlockedIp('93.184.216.34')).toBe(false));
});

describe('createGuardedLookup (DNS rebinding)', () => {
  const run = (records: Array<{ address: string; family: number }>) =>
    new Promise<{ err: Error | null; address?: unknown }>((resolve) =>
      createGuardedLookup(async () => records)('x.example.com', { all: true }, (err, address) => resolve({ err, address })),
    );

  it('rejects a hostname that resolves to a private address', async () => {
    const res = await run([{ address: '10.0.0.5', family: 4 }]);
    expect(res.err).toBeInstanceOf(SsrfError);
  });

  it('rejects mixed public/private answers', async () => {
    const res = await run([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    expect(res.err).toBeInstanceOf(SsrfError);
  });

  it('passes public answers through', async () => {
    const res = await run([{ address: '93.184.216.34', family: 4 }]);
    expect(res.err).toBeNull();
  });
});

describe('createSafeFetch', () => {
  it('refuses private targets before connecting', async () => {
    const safe = createSafeFetch();
    await expect(safe('http://example.com/')).rejects.toBeInstanceOf(SsrfError);
    await expect(safe('https://127.0.0.1/')).rejects.toBeInstanceOf(SsrfError);
  });

  it('refuses a hostname resolving to a private IP', async () => {
    const safe = createSafeFetch({ resolver: async () => [{ address: '10.1.2.3', family: 4 }] });
    await expect(safe('https://rebind.example.com/')).rejects.toThrow(/private/i);
  });
});

describe('connector', () => {
  const config = parseConnectorConfig({ baseUrl: 'https://api.example.com/v1/', allowedPaths: '/items,/users', allowedMethods: 'get,post' });

  it('parses and clamps config', () => {
    expect(config.baseUrl).toBe('https://api.example.com/v1');
    expect(config.allowedMethods).toEqual(['GET', 'POST']);
    expect(parseConnectorConfig({ baseUrl: 'https://a.com', timeoutMs: '999999' }).timeoutMs).toBe(30_000);
  });

  it('enforces the path allow-list and blocks traversal and absolute URLs', () => {
    expect(resolveConnectorUrl(config, '/items/42', { q: 'a' })).toEqual({ ok: true, url: 'https://api.example.com/v1/items/42?q=a' });
    expect(resolveConnectorUrl(config, '/admin').ok).toBe(false);
    expect(resolveConnectorUrl(config, '/items/../admin').ok).toBe(false);
    expect(resolveConnectorUrl(config, '/items/%2e%2e/admin').ok).toBe(false);
    expect(resolveConnectorUrl(config, '//evil.com/items').ok).toBe(false);
    expect(resolveConnectorUrl(config, 'https://evil.com/items').ok).toBe(false);
  });

  it('builds auth headers from the secret and strips caller-supplied auth', () => {
    const bearerCfg = parseConnectorConfig({ baseUrl: 'https://a.com', authScheme: 'bearer' });
    expect(buildAuthHeaders(bearerCfg, 'tok').get('authorization')).toBe('Bearer tok');
    const headers = filterCallerHeaders({ Authorization: 'x', Cookie: 'c', Host: 'h', 'X-Api-Key': 'k', accept: 'application/json' }, 'X-Api-Key');
    expect([...headers.keys()]).toEqual(['accept']);
  });
});

describe('parsePostgresUrl', () => {
  it('requires TLS and a public-looking host', () => {
    expect(parsePostgresUrl('postgresql://u:p@db.example.com:5432/app?sslmode=require').ok).toBe(true);
    expect(parsePostgresUrl('postgresql://u:p@localhost:5432/app?sslmode=require').ok).toBe(false);
    expect(parsePostgresUrl('postgresql://u:p@db.example.com:5432/app?sslmode=disable').ok).toBe(false);
    expect(parsePostgresUrl('mysql://u:p@db.example.com/app').ok).toBe(false);
  });
});

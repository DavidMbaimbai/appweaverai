import { describe, expect, it } from 'vitest';

import {
  extractSubdomainLabel,
  subdomainHost,
  validateSubdomain,
} from './subdomain';

describe('validateSubdomain', () => {
  it('accepts and normalizes valid names', () => {
    expect(validateSubdomain('  My-App-1 ')).toEqual({
      ok: true,
      value: 'my-app-1',
    });
  });

  it.each(['ab', 'a'.repeat(64), '-abc', 'abc-', 'my_app', 'my.app', 'xn--abc'])(
    'rejects invalid name %s',
    (name) => {
      expect(validateSubdomain(name).ok).toBe(false);
    },
  );

  it.each(['www', 'app', 'API', 'admin', 'mail'])('rejects reserved %s', (name) => {
    const result = validateSubdomain(name);
    expect(result.ok).toBe(false);
  });
});

describe('extractSubdomainLabel', () => {
  it('extracts a claimable label', () => {
    expect(extractSubdomainLabel('Shop.appweaverai.com:443', 'appweaverai.com')).toBe(
      'shop',
    );
  });

  it('ignores the root, reserved and nested hosts', () => {
    expect(extractSubdomainLabel('appweaverai.com', 'appweaverai.com')).toBeNull();
    expect(extractSubdomainLabel('www.appweaverai.com', 'appweaverai.com')).toBeNull();
    expect(extractSubdomainLabel('a.b.appweaverai.com', 'appweaverai.com')).toBeNull();
    expect(extractSubdomainLabel('shop.example.com', 'appweaverai.com')).toBeNull();
  });
});

describe('subdomainHost', () => {
  it('joins label and root', () => {
    expect(subdomainHost('shop', 'example.com')).toBe('shop.example.com');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  classifySmoke,
  extractPageSignals,
  guardedFetch,
  isFixConfirmed,
  resolveSmokeTarget,
  smokeCheckUrl,
} from './smoke';

const page = (status: number, body = '', contentType = 'text/html') => ({
  status,
  contentType,
  body,
  finalUrl: 'https://app.example.com/',
});

describe('resolveSmokeTarget', () => {
  it('prefers the custom domain, then path or host deployments', () => {
    expect(resolveSmokeTarget({ domain: '/p/w/s', customDomain: 'shop.example.com' }, 'https://x.io')?.url).toBe(
      'https://shop.example.com/',
    );
    expect(resolveSmokeTarget({ domain: '/p/w/s', customDomain: null }, 'https://x.io')).toEqual({
      url: 'https://x.io/p/w/s',
      allowedHosts: ['x.io'],
    });
    expect(resolveSmokeTarget({ domain: '/p/w/s', customDomain: null }, '')).toBeNull();
  });
});

describe('guardedFetch', () => {
  it('rejects hosts that are not the project domain before any network call', async () => {
    await expect(guardedFetch('https://evil.example.org/', ['app.example.com'])).rejects.toThrow(/own domain/);
    await expect(guardedFetch('http://app.example.com/', ['app.example.com'])).rejects.toThrow(/https/);
  });
});

describe('extractPageSignals', () => {
  it('reads title, forms and same-origin links only', () => {
    const s = extractPageSignals(
      '<title>Shop</title><a href="/about">a</a><a href="https://other.com/x">o</a><a href="#top">t</a><form></form>',
      'https://app.example.com/',
    );
    expect(s).toEqual({ title: 'Shop', links: ['https://app.example.com/about'], formCount: 1 });
  });
});

describe('smokeCheckUrl', () => {
  const hosts = ['app.example.com'];

  it('passes a healthy page whose links resolve', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/about') ? page(200, '<title>About</title>') : page(200, '<title>Home</title><a href="/about">a</a><form></form>'),
    );
    const res = await smokeCheckUrl('https://app.example.com/', hosts, fetcher);
    expect(res.outcome).toBe('PASS');
    expect(res.title).toBe('Home');
  });

  it('reports CONFIRMED_FAILURE when the page is a 5xx twice', async () => {
    const fetcher = vi.fn(async () => page(503));
    const res = await smokeCheckUrl('https://app.example.com/', hosts, fetcher);
    expect(res.outcome).toBe('CONFIRMED_FAILURE');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports only SUSPECTED for a network error', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('timeout');
    });
    expect((await smokeCheckUrl('https://app.example.com/', hosts, fetcher)).outcome).toBe('SUSPECTED');
  });

  it('does not confirm a failure when the retry succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => (calls++ === 0 ? page(500) : page(200, '<title>Ok</title>')));
    expect((await smokeCheckUrl('https://app.example.com/', hosts, fetcher)).outcome).toBe('PASS');
  });

  it('flags a missing title as SUSPECTED and broken links 404 as CONFIRMED', async () => {
    const noTitle = vi.fn(async () => page(200, '<p>hi</p>'));
    expect((await smokeCheckUrl('https://app.example.com/', hosts, noTitle)).outcome).toBe('SUSPECTED');

    const broken = vi.fn(async (url: string) =>
      url.endsWith('/gone') ? page(404) : page(200, '<title>T</title><a href="/gone">x</a>'),
    );
    expect((await smokeCheckUrl('https://app.example.com/', hosts, broken)).outcome).toBe('CONFIRMED_FAILURE');
  });
});

describe('classifySmoke', () => {
  it('ignores informational findings', () => {
    expect(classifySmoke([{ name: 'forms', ok: false, informational: true, detail: '' }])).toBe('PASS');
  });
});

describe('isFixConfirmed', () => {
  const since = new Date('2026-01-02T00:00:00Z');
  it('needs a passing check after the fix and no later failure', () => {
    expect(isFixConfirmed([{ id: 'a', outcome: 'PASS', checkedAt: new Date('2026-01-01T00:00:00Z') }], since).confirmed).toBe(false);
    expect(isFixConfirmed([{ id: 'b', outcome: 'PASS', checkedAt: new Date('2026-01-03T00:00:00Z') }], since)).toEqual({
      confirmed: true,
      checkId: 'b',
    });
    expect(
      isFixConfirmed(
        [
          { id: 'b', outcome: 'PASS', checkedAt: new Date('2026-01-03T00:00:00Z') },
          { id: 'c', outcome: 'CONFIRMED_FAILURE', checkedAt: new Date('2026-01-04T00:00:00Z') },
        ],
        since,
      ).confirmed,
    ).toBe(false);
  });
});

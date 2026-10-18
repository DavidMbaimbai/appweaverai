import { afterEach, describe, expect, it, vi } from 'vitest';

import { rateLimit } from '@/lib/rate-limit';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('rateLimit', () => {
  it('limits per key in memory when Redis is not configured', async () => {
    const key = `mem:${Math.random()}`;
    expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 2, 60_000)).ok).toBe(false);
  });

  it('uses Upstash Redis when configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ result: 5 }, { result: 0 }, { result: 30_000 }])),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await rateLimit('shared', 3, 60_000);
    expect(result).toEqual({ ok: false, retryAfter: 30 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back to memory when Redis fails', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    expect((await rateLimit(`fallback:${Math.random()}`, 1, 60_000)).ok).toBe(true);
  });
});

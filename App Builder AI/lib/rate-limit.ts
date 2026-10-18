import { createHash, timingSafeEqual } from 'node:crypto';

type Bucket = { count: number; resetAt: number };

// Fixed window. Uses Upstash Redis (REST) when configured so the limit is
// shared across instances; otherwise (or if Redis is unreachable) falls back to
// a per-instance in-memory window.
const buckets = new Map<string, Bucket>();

type LimitResult = { ok: boolean; retryAfter: number };

async function redisRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<LimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;

  try {
    const redisKey = `aw:rl:${key}`;
    const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, String(windowMs), 'NX'],
        ['PTTL', redisKey],
      ]),
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Array<{ result?: number; error?: string }>;
    const count = data[0]?.result;
    const ttl = data[2]?.result;
    if (typeof count !== 'number' || data[0]?.error) return null;
    return {
      ok: count <= limit,
      retryAfter: Math.max(1, Math.ceil((typeof ttl === 'number' && ttl > 0 ? ttl : windowMs) / 1000)),
    };
  } catch {
    return null;
  }
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<LimitResult> {
  return (await redisRateLimit(key, limit, windowMs)) ?? memoryRateLimit(key, limit, windowMs);
}

export function memoryRateLimit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/** Returns a 429 response when the limit is exceeded, otherwise null. */
export async function limitOrResponse(key: string, limit: number, windowMs: number) {
  const result = await rateLimit(key, limit, windowMs);
  if (result.ok) return null;
  return new Response(JSON.stringify({ error: 'Too many requests. Try again shortly.' }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(result.retryAfter),
    },
  });
}

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function hasBearerSecret(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

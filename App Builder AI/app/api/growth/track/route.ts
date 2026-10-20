import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  buildTouch,
  GROWTH_COOKIE,
  GROWTH_COOKIE_MAX_AGE_SECONDS,
  growthSecret,
  mayTrack,
  mergeTouch,
  readGrowthCookie,
  signCookie,
} from '@/lib/growth-bi/attribution';
import { recordVisit } from '@/lib/growth-bi/capture';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

/**
 * Public first-party visit beacon. Records nothing without "all" cookie consent or when DNT/GPC is set. The IP is only
 * hashed for rate limiting and never stored; the stored visitor id is a random value from the signed cookie.
 */
export async function POST(request: Request) {
  if (!mayTrack(request.headers)) return NO_CONTENT();
  const secret = growthSecret();
  if (!secret || !process.env.DATABASE_URL) return NO_CONTENT();

  const ipHash = createHash('sha256').update(clientIp(request)).digest('hex').slice(0, 24);
  const limited = await limitOrResponse(`growth-track:${ipHash}`, 60, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { path?: unknown; search?: unknown; referrer?: unknown } | null;
  const path = typeof body?.path === 'string' ? body.path.slice(0, 200) : '/';
  const search = typeof body?.search === 'string' ? body.search.slice(0, 600) : '';
  const referrer = typeof body?.referrer === 'string' ? body.referrer.slice(0, 500) : null;
  const ownHost = request.headers.get('host')?.split(':')[0]?.replace(/^www\./, '');

  const previous = readGrowthCookie(request.headers.get('cookie'), secret);
  const touch = buildTouch({ search: new URLSearchParams(search), referrer, path, ownHosts: ownHost ? [ownHost] : [] });
  const next = mergeTouch(previous, touch);
  // Count a visit only when it carries a signal or starts a new visitor, so reloads of a direct page do not inflate it.
  if (!previous || touch.channel !== 'direct') await recordVisit(next, touch);

  const response = NO_CONTENT();
  response.cookies.set(GROWTH_COOKIE, signCookie(next, secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GROWTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

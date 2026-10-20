import { NextResponse } from 'next/server';

import { customerAdsConfigured, loginUrl } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';

/** Starts the "Connect Facebook" login for the signed-in user. */
export async function GET(request: Request) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.redirect(new URL('/?auth=login&callbackUrl=/app/studio', request.url));
  if (!customerAdsConfigured()) {
    return NextResponse.json({ error: 'Meta ads are not configured.' }, { status: 503 });
  }
  return NextResponse.redirect(loginUrl(userId));
}

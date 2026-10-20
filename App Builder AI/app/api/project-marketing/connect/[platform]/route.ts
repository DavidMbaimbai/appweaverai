import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';
import {
  authorizeUrl,
  createPkce,
  createState,
  isConnectConfigured,
  isConnectPlatform,
  safeReturnTo,
} from '@/lib/project-marketing/oauth';

const PKCE_COOKIE = 'pm_pkce';

/** Starts the owner's OAuth flow for one social platform. */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = (await params).platform.toUpperCase();
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('project'));
  const userId = (await getCachedSession())?.user?.id;
  if (!userId || !returnTo || !isConnectPlatform(platform) || !isConnectConfigured(platform)) {
    return NextResponse.redirect(`${appBaseUrl()}/app/projects`);
  }

  const pkce = platform === 'X' ? createPkce() : null;
  const response = NextResponse.redirect(
    authorizeUrl(platform, createState(platform, { userId, returnTo }), pkce?.challenge),
  );
  if (pkce) {
    response.cookies.set(PKCE_COOKIE, pkce.verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/api/project-marketing',
    });
  }
  return response;
}

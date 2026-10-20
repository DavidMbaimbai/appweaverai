import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';
import { encryptSecret } from '@/lib/crypto/secret-box';
import {
  exchangeCode,
  isConnectConfigured,
  isConnectPlatform,
  safeReturnTo,
  verifyState,
} from '@/lib/project-marketing/oauth';
import { PAGE_CHOICE_COOKIE, PAGE_CHOICE_TTL_SECONDS, packPageChoices } from '@/lib/project-marketing/pages';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = (await params).platform.toUpperCase();
  const url = new URL(request.url);
  if (!isConnectPlatform(platform) || !isConnectConfigured(platform)) {
    return NextResponse.redirect(`${appBaseUrl()}/app/projects`);
  }

  const state = verifyState(platform, url.searchParams.get('state'));
  const returnTo = safeReturnTo(state?.returnTo ?? null);
  const back = (flag: string) => {
    const response = NextResponse.redirect(
      returnTo ? `${appBaseUrl()}/app/projects/${returnTo}/marketing?connect=${flag}` : `${appBaseUrl()}/app/projects`,
    );
    response.cookies.delete({ name: 'pm_pkce', path: '/api/project-marketing' });
    return response;
  };

  const sessionUser = (await getCachedSession())?.user?.id;
  const code = url.searchParams.get('code');
  if (!sessionUser || !state || state.userId !== sessionUser || !code) return back('denied');

  try {
    const verifier = request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('pm_pkce='))
      ?.slice('pm_pkce='.length);
    const tokens = await exchangeCode(platform, code, verifier);
    if (platform === 'FACEBOOK' && (tokens.pages?.length ?? 0) > 1) {
      // Several Pages: let the owner choose before anything is stored.
      const response = back('choose-page');
      response.cookies.set(PAGE_CHOICE_COOKIE, packPageChoices(tokens.pages ?? []), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: PAGE_CHOICE_TTL_SECONDS,
        path: '/app/projects',
      });
      return response;
    }
    const data = {
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt,
      accountName: tokens.accountName,
      accountId: tokens.accountId,
    };
    await prisma.socialConnection.upsert({
      where: { userId_platform: { userId: sessionUser, platform } },
      create: { userId: sessionUser, platform, ...data },
      update: data,
    });
    return back(platform.toLowerCase());
  } catch (error) {
    console.error('[project-marketing] connect failed:', error);
    return back('error');
  }
}

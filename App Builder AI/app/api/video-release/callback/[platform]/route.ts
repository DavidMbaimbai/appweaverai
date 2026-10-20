import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';
import { encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import {
  VIDEO_RETURN_PATH,
  exchangeVideoCode,
  isVideoConnectConfigured,
  isVideoConnectPlatform,
  verifyVideoState,
} from '@/lib/video-release/oauth';

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = (await params).platform.toUpperCase();
  const back = (flag: string) => NextResponse.redirect(`${appBaseUrl()}${VIDEO_RETURN_PATH}?connect=${flag}`);
  if (!isVideoConnectPlatform(platform) || !isVideoConnectConfigured(platform)) return back('unavailable');

  const url = new URL(request.url);
  const sessionUser = (await getCachedSession())?.user?.id;
  const stateUser = verifyVideoState(platform, url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  if (!sessionUser || !stateUser || stateUser !== sessionUser || !code) return back('denied');

  try {
    const tokens = await exchangeVideoCode(platform, code);
    const data = {
      accessTokenEnc: encryptSecret(tokens.accessToken),
      // Keep an existing refresh token if the platform did not send a new one.
      ...(tokens.refreshToken ? { refreshTokenEnc: encryptSecret(tokens.refreshToken) } : {}),
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
    console.error('[video-release] connect failed:', error);
    return back('error');
  }
}

import { NextResponse } from 'next/server';

import { appBaseUrl, exchangeCode, verifyState } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';
import { encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (flag: string) => NextResponse.redirect(`${appBaseUrl()}/app/studio?meta=${flag}`);

  const sessionUser = (await getCachedSession())?.user?.id;
  const stateUser = verifyState(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  if (!sessionUser || !stateUser || sessionUser !== stateUser || !code) return back('denied');

  try {
    const { token, expiresAt } = await exchangeCode(code);
    const accessTokenEnc = encryptSecret(token);
    // A fresh login clears the chosen account and page so the user re-confirms where money is spent.
    await prisma.metaAdConnection.upsert({
      where: { userId: sessionUser },
      create: { userId: sessionUser, accessTokenEnc, tokenExpiresAt: expiresAt },
      update: {
        accessTokenEnc,
        tokenExpiresAt: expiresAt,
        adAccountId: null,
        adAccountName: null,
        currency: null,
        pageId: null,
        pageName: null,
      },
    });
    return back('connected');
  } catch (error) {
    console.error('[meta-ads] connect failed:', error);
    return back('error');
  }
}

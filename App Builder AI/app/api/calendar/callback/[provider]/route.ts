import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';
import { completeConnect } from '@/lib/calendar/service';

export const dynamic = 'force-dynamic';

/** Only same-app paths under /app or /admin are accepted as the post-connect destination. */
function safePath(value: string) {
  return /^\/(app|admin)\/[A-Za-z0-9/_-]{0,200}$/.test(value) && !value.includes('//') ? value : '/app/projects';
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = (await params).provider.toUpperCase();
  const url = new URL(request.url);
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.redirect(`${appBaseUrl()}/app/projects`);
  if (url.searchParams.get('error')) {
    return NextResponse.redirect(`${appBaseUrl()}/app/projects?calendar=denied`);
  }
  const outcome = await completeConnect({ state: url.searchParams.get('state'), code: url.searchParams.get('code'), userId, provider });
  const dest = new URL(`${appBaseUrl()}${safePath(outcome.returnTo)}`);
  dest.searchParams.set('calendar', outcome.ok ? 'connected' : 'error');
  return NextResponse.redirect(dest.toString());
}

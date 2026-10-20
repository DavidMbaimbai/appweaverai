import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { toCsv } from '@/lib/growth-bi/csv';
import { collectPlatform } from '@/lib/growth-bi/platform';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireAdmin('growth:read');
  if (!auth.ok) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const url = new URL(request.url);
  const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const model = url.searchParams.get('model') === 'last' ? 'last' : 'first';
  const to = new Date();
  const snap = await collectPlatform(new Date(to.getTime() - days * 86_400_000), to, model);

  const row = (dimension: string, r: (typeof snap.funnel.byChannel)[number]) => [dimension, r.key, r.visitors ?? '', r.signups, r.activated, r.paid, r.visitorToSignup ?? '', r.signupToActivated ?? '', r.activatedToPaid ?? ''];
  const csv = toCsv(
    ['dimension', 'key', 'visitors', 'signups', 'activated', 'paid', 'visitor_to_signup', 'signup_to_activated', 'activated_to_paid'],
    [row('all', snap.funnel.all), ...snap.funnel.byChannel.map((r) => row('channel', r)), ...snap.funnel.byCampaign.map((r) => row('campaign', r))],
  );
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="growth-${model}-${days}d.csv"`, 'cache-control': 'no-store' },
  });
}

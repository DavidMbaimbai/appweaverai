import { NextResponse } from 'next/server';

import { runBillingAlertsSweep } from '@/lib/billing/alerts';

/**
 * Scheduled endpoint that sends "renewal in N days" and "credits low/
 * depleted" emails. Trigger this daily via Vercel Cron (see vercel.json) or
 * any external scheduler, authenticated with the CRON_SECRET env var.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  } else {
    console.warn(
      '[cron/billing-alerts] CRON_SECRET is not set — endpoint is unauthenticated.',
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 500 },
    );
  }

  try {
    const result = await runBillingAlertsSweep();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[cron/billing-alerts] sweep failed:', error);
    return NextResponse.json(
      { error: 'Billing alerts sweep failed.' },
      { status: 500 },
    );
  }
}

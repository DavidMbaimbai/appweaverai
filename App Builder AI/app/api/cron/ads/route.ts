import { NextResponse } from 'next/server';

import { runAdsCycle } from '@/lib/ads/run';
import { sendAlert } from '@/lib/alerts';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

/** Daily cron: syncs ad results, pauses weak ads and launches a new AI-made ad. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  if (!hasBearerSecret(request, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  }

  try {
    return NextResponse.json({ success: true, ...(await runAdsCycle()) });
  } catch (error) {
    console.error('[cron/ads] failed:', error);
    await sendAlert('Cron ads crashed', String(error));
    return NextResponse.json({ error: 'Ads cycle failed.' }, { status: 500 });
  }
}

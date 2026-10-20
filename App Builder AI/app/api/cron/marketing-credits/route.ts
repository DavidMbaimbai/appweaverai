import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { expireLots, releaseStaleReservations } from '@/lib/marketing-credits/wallet';
import { hasBearerSecret } from '@/lib/rate-limit';

/** Releases stale marketing-credit reservations and expires lapsed promo credits. */
export const GET = monitoredCron('marketing-credits', handler);

async function handler(request: Request) {
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
    const released = await releaseStaleReservations();
    const expired = await expireLots();
    return NextResponse.json({ success: true, released, expired });
  } catch (error) {
    console.error('[cron/marketing-credits] failed:', error);
    return NextResponse.json({ error: 'Sweep failed.' }, { status: 500 });
  }
}

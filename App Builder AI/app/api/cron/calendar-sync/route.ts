import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { pollCalendarSync } from '@/lib/calendar/bookings';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 120;

/** Every 10 minutes: re-verifies connections, detects external changes, retries pending calendar events. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!hasBearerSecret(request, cronSecret)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  try {
    return NextResponse.json({ success: true, ...(await pollCalendarSync()) });
  } catch (error) {
    console.error('[cron/calendar-sync] failed:', error);
    await sendAlert('Cron calendar-sync crashed', String(error));
    return NextResponse.json({ error: 'Calendar sync failed.' }, { status: 500 });
  }
}

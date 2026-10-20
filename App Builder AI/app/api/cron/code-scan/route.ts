import { NextResponse } from 'next/server';

import { runDueScans } from '@/lib/code-scan/schedule';
import { monitoredCron } from '@/lib/monitoring/cron';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

/** Hourly: re-scans projects whose schedule is due (Pro plan; deterministic, no credits spent). */
export const GET = monitoredCron('code-scan', async (request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!hasBearerSecret(request, cronSecret)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });

  const summary = await runDueScans();
  return NextResponse.json({ success: true, ...summary });
});

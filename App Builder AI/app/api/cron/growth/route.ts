import { NextResponse } from 'next/server';

import { runNightly } from '@/lib/growth-bi/rollup';
import { monitoredCron } from '@/lib/monitoring/cron';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

/** Nightly: idempotently recomputes the last days of growth rollups and raises anomaly alerts. */
export const GET = monitoredCron('growth', async (request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!hasBearerSecret(request, cronSecret)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const days = Number(url.searchParams.get('days') ?? 3);
  const result = await runNightly({ days: Number.isFinite(days) ? days : 3 });
  return NextResponse.json({ success: true, ...result });
});

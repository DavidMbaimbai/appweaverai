import { NextResponse } from 'next/server';

import { monitoredCron } from '@/lib/monitoring/cron';
import { expireExports, processExportQueue } from '@/lib/privacy/export';
import { expireUnverifiedRequests, requestsSummary } from '@/lib/privacy/requests';
import { runRetention } from '@/lib/privacy/retention';
import { processDueDeletions } from '@/lib/privacy/user-erasure';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

/** Hourly: builds queued exports, executes account deletions whose grace period ended, purges expired data per retention policy. */
export const GET = monitoredCron('privacy', async (request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!hasBearerSecret(request, cronSecret)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });

  const exports = await processExportQueue();
  const expiredExports = await expireExports();
  const deletions = await processDueDeletions();
  const retention = await runRetention();
  const expiredRequests = await expireUnverifiedRequests();
  const requests = await requestsSummary();
  return NextResponse.json({ success: true, exports, expiredExports, deletions, retention, expiredRequests, requests });
});

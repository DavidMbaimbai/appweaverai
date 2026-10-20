import { NextResponse } from 'next/server';

import { runHealthSweep } from '@/lib/integrations/service';
import { processDueDeliveries, pruneWebhookData } from '@/lib/integrations/webhooks';
import { monitoredCron } from '@/lib/monitoring/cron';
import { hasBearerSecret } from '@/lib/rate-limit';

/** Delivers due outbound webhooks (with backoff), re-checks stale integration health, prunes old logs. */
export const GET = monitoredCron('integrations', async (request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!hasBearerSecret(request, cronSecret)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });

  const deliveries = await processDueDeliveries(50);
  const health = await runHealthSweep(25);
  const pruned = new Date().getUTCHours() === 3 ? await pruneWebhookData(30) : null;
  return NextResponse.json({ success: true, deliveries, health, pruned });
});

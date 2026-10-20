import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { sendAlert } from '@/lib/alerts';
import { runInvestorCampaigns } from '@/lib/investor-hub/campaigns';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 120;

/** Every 15 minutes: sends due emails for owner-approved Investor Hub campaigns within limits and window. */
export const GET = monitoredCron('investor-campaigns', handler);

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
    return NextResponse.json({ success: true, ...(await runInvestorCampaigns()) });
  } catch (error) {
    console.error('[cron/investor-campaigns] failed:', error);
    await sendAlert('Cron investor-campaigns crashed', String(error));
    return NextResponse.json({ error: 'Campaign run failed.' }, { status: 500 });
  }
}

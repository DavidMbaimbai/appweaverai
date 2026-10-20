import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { sendAlert } from '@/lib/alerts';
import { hasBearerSecret } from '@/lib/rate-limit';
import { runVideoReleases } from '@/lib/video-release/run';

export const maxDuration = 300;

/** Every 5 minutes: publishes due, owner-approved video releases to the owner's connected accounts. */
export const GET = monitoredCron('video-releases', handler);

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
    return NextResponse.json({ success: true, ...(await runVideoReleases()) });
  } catch (error) {
    console.error('[cron/video-releases] failed:', error);
    await sendAlert('Cron video-releases crashed', String(error));
    return NextResponse.json({ error: 'Publishing failed.' }, { status: 500 });
  }
}

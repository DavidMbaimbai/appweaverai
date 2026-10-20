import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { sendAlert } from '@/lib/alerts';
import { hasBearerSecret } from '@/lib/rate-limit';
import { pollSocialSources } from '@/lib/social/replies/sources';

export const maxDuration = 300;

/** Cron: pulls new X mentions and YouTube comments into the reply queue. */
export const GET = monitoredCron('social-ingest', handler);

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
    return NextResponse.json({ success: true, received: await pollSocialSources() });
  } catch (error) {
    console.error('[cron/social-ingest] failed:', error);
    await sendAlert('Cron social-ingest crashed', String(error));
    return NextResponse.json({ error: 'Social ingest failed.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { hasBearerSecret } from '@/lib/rate-limit';
import { processVideoJobs } from '@/lib/video/jobs';

export const maxDuration = 120;

/** Submits due video jobs (with retry/backoff) and polls in-flight ones. */
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
    return NextResponse.json({ success: true, ...(await processVideoJobs()) });
  } catch (error) {
    console.error('[cron/video-jobs] failed:', error);
    await sendAlert('Cron video-jobs crashed', String(error));
    return NextResponse.json({ error: 'Video job run failed.' }, { status: 500 });
  }
}

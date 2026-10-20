import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { runContentPipelines } from '@/lib/content-pipeline/engine';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

/** Hourly: starts each pipeline whose local time of day has passed (once per day) and resumes open runs. */
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
    return NextResponse.json({ success: true, ...(await runContentPipelines()) });
  } catch (error) {
    console.error('[cron/content-pipeline] failed:', error);
    await sendAlert('Cron content-pipeline crashed', String(error));
    return NextResponse.json({ error: 'Content pipeline failed.' }, { status: 500 });
  }
}

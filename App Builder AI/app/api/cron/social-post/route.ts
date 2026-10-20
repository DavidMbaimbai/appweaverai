import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { sendAlert } from '@/lib/alerts';
import { isAgentPaused } from '@/lib/agents/pause';
import { hasBearerSecret } from '@/lib/rate-limit';
import { ensureAdvertQueue } from '@/lib/social/adverts';
import { publishNextDueSocialPost } from '@/lib/social/publish';

export const maxDuration = 300;

/** Daily cron: publishes the next queued marketing post to social media. */
export const GET = monitoredCron('social-post', handler);

async function handler(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured.' },
      { status: 500 },
    );
  }
  if (!hasBearerSecret(request, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 500 },
    );
  }

  try {
    if (await isAgentPaused('SOCIAL_MANAGER')) {
      return NextResponse.json({ success: true, paused: true });
    }
    const adverts = await ensureAdvertQueue();
    return NextResponse.json({
      success: true,
      adverts,
      ...(await publishNextDueSocialPost()),
    });
  } catch (error) {
    console.error('[cron/social-post] failed:', error);
    await sendAlert('Cron social-post crashed', String(error));
    return NextResponse.json({ error: 'Social post failed.' }, { status: 500 });
  }
}

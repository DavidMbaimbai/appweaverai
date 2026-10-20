import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { isAgentPaused } from '@/lib/agents/pause';
import { hasBearerSecret } from '@/lib/rate-limit';
import { processSocialReplies } from '@/lib/social/replies/process';

export const maxDuration = 300;

/** Cron: classifies new social interactions and answers or queues them for approval. */
export async function GET(request: Request) {
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
    return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  }

  try {
    if (await isAgentPaused('CUSTOMER_ENGAGEMENT')) {
      return NextResponse.json({ success: true, paused: true });
    }
    return NextResponse.json({ success: true, ...(await processSocialReplies()) });
  } catch (error) {
    console.error('[cron/social-replies] failed:', error);
    await sendAlert('Cron social-replies crashed', String(error));
    return NextResponse.json({ error: 'Social replies failed.' }, { status: 500 });
  }
}

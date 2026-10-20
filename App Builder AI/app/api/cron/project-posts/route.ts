import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { publishDueProjectPosts } from '@/lib/project-marketing/publish';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 120;

/** Every 15 minutes: publishes due, owner-approved project posts to the owner's connected accounts. */
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
    return NextResponse.json({ success: true, ...(await publishDueProjectPosts()) });
  } catch (error) {
    console.error('[cron/project-posts] failed:', error);
    await sendAlert('Cron project-posts crashed', String(error));
    return NextResponse.json({ error: 'Publishing failed.' }, { status: 500 });
  }
}

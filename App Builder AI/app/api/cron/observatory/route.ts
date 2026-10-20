import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { verifyPendingIssues } from '@/lib/observatory/issues';
import { runSmokeBatch } from '@/lib/observatory/smoke';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

/** Every 30 minutes: smoke-checks deployed apps in batches, then verifies fixes that now have a later passing check. */
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
    const smoke = await runSmokeBatch(20);
    const issues = await verifyPendingIssues();
    return NextResponse.json({ success: true, smoke, issues });
  } catch (error) {
    console.error('[cron/observatory] failed:', error);
    await sendAlert('Cron observatory crashed', String(error));
    return NextResponse.json({ error: 'Observatory run failed.' }, { status: 500 });
  }
}

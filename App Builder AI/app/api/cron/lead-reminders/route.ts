import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { sendAlert } from '@/lib/alerts';
import { sendLeadReminderDigests } from '@/lib/leads/reminders';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 120;

/** Daily: emails each owner a digest of lead follow-ups that are due. */
export const GET = monitoredCron('lead-reminders', handler);

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
    return NextResponse.json({ success: true, ...(await sendLeadReminderDigests()) });
  } catch (error) {
    console.error('[cron/lead-reminders] failed:', error);
    await sendAlert('Cron lead-reminders crashed', String(error));
    return NextResponse.json({ error: 'Reminders failed.' }, { status: 500 });
  }
}

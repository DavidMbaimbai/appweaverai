import { NextResponse } from 'next/server';
import { monitoredCron } from '@/lib/monitoring/cron';

import { sendAlert } from '@/lib/alerts';
import { processDueReminders } from '@/lib/meetings/notify';
import { purgeRetention, syncMeetingsWithCalendar } from '@/lib/meetings/service';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 120;

/** Every 5 minutes: sends due confirmations/reminders (deduped, retried with backoff), mirrors calendar changes, purges expired notes. */
export const GET = monitoredCron('meeting-reminders', handler);

async function handler(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!hasBearerSecret(request, cronSecret)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  try {
    const reminders = await processDueReminders();
    const calendar = await syncMeetingsWithCalendar();
    const purged = await purgeRetention();
    if (reminders.failed > 0) await sendAlert('Meeting reminders failed', `${reminders.failed} reminder(s) exhausted their retries.`);
    return NextResponse.json({ success: true, reminders, calendar, purged });
  } catch (error) {
    console.error('[cron/meeting-reminders] failed:', error);
    await sendAlert('Cron meeting-reminders crashed', String(error));
    return NextResponse.json({ error: 'Meeting reminders failed.' }, { status: 500 });
  }
}

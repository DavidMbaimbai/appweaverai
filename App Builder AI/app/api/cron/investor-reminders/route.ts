import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { sendInvestorReminderDigests } from '@/lib/investor-hub/reminders';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 120;

/** Daily: emails each owner a digest of Investor Hub follow-ups that are due. */
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
    return NextResponse.json({ success: true, ...(await sendInvestorReminderDigests()) });
  } catch (error) {
    console.error('[cron/investor-reminders] failed:', error);
    await sendAlert('Cron investor-reminders crashed', String(error));
    return NextResponse.json({ error: 'Reminders failed.' }, { status: 500 });
  }
}

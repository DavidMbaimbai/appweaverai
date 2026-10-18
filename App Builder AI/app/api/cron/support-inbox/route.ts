import { NextResponse } from 'next/server';

import { sendAlert } from '@/lib/alerts';
import { hasBearerSecret } from '@/lib/rate-limit';
import {
  isInboxConfigured,
  processSupportInbox,
} from '@/lib/support-inbox/process-inbox';

export const maxDuration = 300;

/**
 * Scheduled endpoint that answers unread mail in the support mailbox
 * (SUPPORT_EMAIL) with an AI-generated reply. Authenticated with CRON_SECRET.
 */
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

  if (!isInboxConfigured()) {
    return NextResponse.json(
      { error: 'IMAP_HOST, IMAP_USER and IMAP_PASSWORD are required.' },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json({ success: true, ...(await processSupportInbox()) });
  } catch (error) {
    console.error('[cron/support-inbox] sweep failed:', error);
    await sendAlert('Cron support-inbox sweep failed', String(error));
    return NextResponse.json({ error: 'Inbox sweep failed.' }, { status: 500 });
  }
}

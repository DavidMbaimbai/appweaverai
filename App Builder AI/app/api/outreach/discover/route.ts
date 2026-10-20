import { NextResponse } from 'next/server';
import { z } from 'zod';

import { sendAlert } from '@/lib/alerts';
import { discoverInvestors } from '@/lib/outreach/process';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

const schema = z.object({ queries: z.array(z.string().min(3).max(200)).max(10).optional() });

/** Searches the web for investors and drafts emails for approval. Nothing is sent. */
export async function POST(request: Request) {
  if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  try {
    return NextResponse.json({ success: true, ...(await discoverInvestors(parsed.data.queries)) });
  } catch (error) {
    console.error('[outreach/discover] failed:', error);
    await sendAlert('Investor discovery failed', String(error));
    return NextResponse.json({ error: 'Discovery failed.' }, { status: 500 });
  }
}

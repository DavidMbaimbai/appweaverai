import { NextResponse } from 'next/server';

import { publishNextDueSocialPost } from '@/lib/social/publish';

export const maxDuration = 300;

/** Daily cron: publishes the next queued marketing post to social media. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured.' },
      { status: 500 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json({
      success: true,
      ...(await publishNextDueSocialPost()),
    });
  } catch (error) {
    console.error('[cron/social-post] failed:', error);
    return NextResponse.json({ error: 'Social post failed.' }, { status: 500 });
  }
}

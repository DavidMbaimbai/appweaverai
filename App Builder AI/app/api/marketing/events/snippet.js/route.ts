/**
 * app/api/marketing/events/snippet.js/route.ts
 *
 * Serves the analytics snippet as a JS file.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { ANALYTICS_SNIPPET } from '@/lib/marketing-analytics/snippet';

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('pid') || 'unknown';
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  
  const body = ANALYTICS_SNIPPET(projectId, appUrl);
  
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}

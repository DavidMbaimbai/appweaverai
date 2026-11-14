/**
 * app/api/marketing/events/route.ts
 *
 * API endpoint to receive conversion events from the analytics snippet.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, eventType, source, medium, campaign, content, term, timestamp } = body;

    if (!projectId || !eventType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const clientIp = req.headers.get('x-forwarded-for') || req.ip || null;
    const userAgent = req.headers.get('user-agent') || null;

    // Record the conversion event
    await prisma.marketingConversionEvent.create({
      data: {
        projectId,
        eventType,
        utmSource: source,
        utmMedium: medium,
        utmCampaign: campaign,
        utmContent: content,
        utmTerm: term,
        clientIp,
        userAgent,
        occurredAt: timestamp ? new Date(timestamp) : new Date(),
        // If utm_content holds the post ID, link it
        postId: content ? content : undefined,
        // If utm_campaign holds the campaign ID, link it
        campaignId: campaign ? campaign : undefined,
      },
    });

    // If it's a visit and we have a post ID, increment clicks immediately
    if (eventType === 'visit' && content) {
      await prisma.marketingPostMetrics.upsert({
        where: { postId: content },
        create: { postId: content, clicks: 1 },
        update: { clicks: { increment: 1 } },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[marketing-events] failed to record event:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

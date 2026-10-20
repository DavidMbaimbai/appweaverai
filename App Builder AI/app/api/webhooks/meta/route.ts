import { after, NextResponse } from 'next/server';

import { parseMetaMessaging, parseMetaMessagingStatus } from '@/lib/messaging/adapters/meta';
import { processInboundBatch } from '@/lib/messaging/webhooks';
import { ingestInteraction } from '@/lib/social/replies/process';
import { parseMetaWebhook, verifyMetaSignature } from '@/lib/social/replies/sources';

/** Meta webhook subscription handshake. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (
    expected &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === expected
  ) {
    return new NextResponse(params.get('hub.challenge') ?? '', { status: 200 });
  }
  return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}

/** Receives Facebook Page and Instagram comment events (signature verified). */
export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'META_APP_SECRET is not configured.' }, { status: 500 });
  }

  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const items = parseMetaWebhook(payload, {
    pageId: process.env.FACEBOOK_PAGE_ID,
    instagramId: process.env.INSTAGRAM_USER_ID,
  });
  for (const item of items) await ingestInteraction(item);

  // Messenger / Instagram direct messages go to the unified inbox.
  const dms = parseMetaMessaging(payload);
  const dmStatuses = parseMetaMessagingStatus(payload);
  if (dms.length || dmStatuses.length) after(() => processInboundBatch(dms, dmStatuses));
  return NextResponse.json({ success: true, received: items.length + dms.length });
}

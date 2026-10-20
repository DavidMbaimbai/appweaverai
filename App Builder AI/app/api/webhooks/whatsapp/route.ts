import { after, NextResponse } from 'next/server';

import { parseWhatsAppInbound, parseWhatsAppStatus, whatsAppVerifyChallenge, whatsappAdapter } from '@/lib/messaging/adapters/whatsapp';
import { processInboundBatch } from '@/lib/messaging/webhooks';

/** WhatsApp Business Cloud API webhook handshake. */
export async function GET(request: Request) {
  const challenge = whatsAppVerifyChallenge(new URL(request.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  if (challenge === null) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

/** Inbound WhatsApp messages and delivery receipts (X-Hub-Signature-256 verified with META_APP_SECRET). */
export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: 'META_APP_SECRET is not configured.' }, { status: 500 });

  const raw = await request.text();
  if (!whatsappAdapter.verifyWebhook?.({ rawBody: raw, header: request.headers.get('x-hub-signature-256'), secret })) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const messages = parseWhatsAppInbound(payload);
  const statuses = parseWhatsAppStatus(payload);
  after(() => processInboundBatch(messages, statuses));
  return NextResponse.json({ success: true, received: messages.length });
}

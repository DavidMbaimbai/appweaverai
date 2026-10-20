import { NextResponse } from 'next/server';

import { MAX_INBOUND_BYTES, receiveInboundWebhook } from '@/lib/integrations/webhooks';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';

type Context = { params: Promise<{ publicId: string }> };

/**
 * Signed inbound webhook for a generated app. Headers: X-Webhook-Id (idempotency key), X-Webhook-Timestamp (unix seconds),
 * X-Webhook-Signature (`v1=` + hex HMAC-SHA256 of `${timestamp}.${rawBody}`).
 */
export async function POST(request: Request, context: Context) {
  const { publicId } = await context.params;
  const limited = await limitOrResponse(`webhook-in-ip:${clientIp(request)}`, 600, 60_000);
  if (limited) return limited;

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_INBOUND_BYTES) return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  const body = await request.text();

  const outcome = await receiveInboundWebhook({
    publicId,
    body,
    headers: {
      id: request.headers.get('x-webhook-id'),
      timestamp: request.headers.get('x-webhook-timestamp'),
      signature: request.headers.get('x-webhook-signature'),
    },
  });
  if (outcome.status === 200) return NextResponse.json({ received: true, duplicate: outcome.duplicate });
  return NextResponse.json({ error: outcome.error }, { status: outcome.status });
}

import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { optOutByPhone } from '@/lib/investor-hub/comms';
import { isStopKeyword, normalizePhone, twilioConfig, verifyTwilioSignature } from '@/lib/investor-hub/sms';

const twiml = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  });

/**
 * Twilio inbound-message webhook. Set it as the "A message comes in" URL of the
 * sending number. A STOP reply opts the investor out of all contact and adds
 * their email to the shared suppression list. Requests must carry a valid
 * X-Twilio-Signature.
 */
export async function POST(request: Request) {
  const { token } = twilioConfig();
  if (!token) return NextResponse.json({ error: 'Twilio is not configured.' }, { status: 503 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') params[key] = value;

  const url = process.env.TWILIO_WEBHOOK_URL?.trim() || `${appBaseUrl()}/api/investor-hub/sms`;
  if (!verifyTwilioSignature(token, url, params, request.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 403 });
  }

  const from = normalizePhone(params.From);
  if (from && isStopKeyword(params.Body ?? '') && process.env.DATABASE_URL) {
    try {
      await optOutByPhone(from);
    } catch (error) {
      console.error('[investor-hub/sms] opt-out failed:', error);
      return NextResponse.json({ error: 'Failed.' }, { status: 500 });
    }
  }
  return twiml();
}

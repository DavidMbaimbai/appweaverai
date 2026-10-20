import { after, NextResponse } from 'next/server';

import { getCredentials, resolveScopeForAccount } from '@/lib/messaging/connections';
import { inboxSmsWebhookUrl, parseSmsInbound, parseSmsStatus, smsAdapter } from '@/lib/messaging/adapters/sms';
import { processInboundBatch } from '@/lib/messaging/webhooks';

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
const xml = (status = 200) => new NextResponse(TWIML_EMPTY, { status, headers: { 'content-type': 'text/xml' } });

/** Twilio inbound SMS and status callbacks for the unified inbox (signature validated per account). */
export async function POST(request: Request) {
  const params: Record<string, string> = {};
  (await request.formData()).forEach((value, key) => {
    if (typeof value === 'string') params[key] = value;
  });

  // Inbound: To is our number. Status callbacks: From is our number.
  const ourNumber = params.MessageStatus ? params.From : params.To;
  const scope = await resolveScopeForAccount('SMS', ourNumber);
  const creds = scope ? await getCredentials(scope, 'SMS') : null;
  const url = inboxSmsWebhookUrl() ?? request.url;
  if (!scope || !creds || !('authToken' in creds)) return xml(403);
  if (!smsAdapter.verifyWebhook?.({ rawBody: '', header: request.headers.get('x-twilio-signature'), secret: creds.authToken, url, params })) {
    return xml(403);
  }

  const inbound = parseSmsInbound(params);
  after(() => processInboundBatch(inbound ? [inbound] : [], parseSmsStatus(params)));
  return xml();
}

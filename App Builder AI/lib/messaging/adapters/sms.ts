import { verifyTwilioSignature } from '@/lib/investor-hub/sms';

import type { InboundMessage, StatusUpdate } from '../types';
import { ChannelSendError, type ChannelAdapter, type SendInput, type SendResult } from './types';

export type TwilioSmsCredentials = { accountSid: string; authToken: string; from: string };

/** Public URL Twilio calls for inbound SMS and status callbacks; also the URL its signature is computed over. */
export function inboxSmsWebhookUrl() {
  const explicit = process.env.TWILIO_INBOX_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/api/webhooks/sms` : null;
}

/** Parses a Twilio inbound-SMS webhook form body. Returns null for status callbacks and malformed bodies. */
export function parseSmsInbound(params: Record<string, string>): InboundMessage | null {
  const { MessageSid, From, To, Body } = params;
  if (!MessageSid || !From || !To || Body === undefined || params.MessageStatus) return null;
  return {
    channel: 'SMS',
    providerMessageId: MessageSid,
    externalThreadId: From,
    contactRef: From,
    contactName: params.ProfileName || undefined,
    body: Body,
    accountId: To,
  };
}

const TWILIO_STATUS: Record<string, StatusUpdate['status']> = {
  accepted: 'QUEUED',
  scheduled: 'QUEUED',
  queued: 'QUEUED',
  sending: 'QUEUED',
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  undelivered: 'FAILED',
  failed: 'FAILED',
};

/** Parses a Twilio status callback (MessageStatus) with its error code. Unknown states are ignored. */
export function parseSmsStatus(params: Record<string, string>): StatusUpdate[] {
  const status = params.MessageStatus ? TWILIO_STATUS[params.MessageStatus] : undefined;
  if (!params.MessageSid || !status) return [];
  return [
    {
      channel: 'SMS',
      providerMessageId: params.MessageSid,
      status,
      eventId: `${params.MessageSid}:${params.MessageStatus}`,
      errorCode: params.ErrorCode || undefined,
      error: params.ErrorCode ? `Twilio error ${params.ErrorCode}${params.ErrorMessage ? `: ${params.ErrorMessage}` : ''}` : undefined,
    },
  ];
}

export const smsAdapter: ChannelAdapter<TwilioSmsCredentials> = {
  channel: 'SMS',
  verifyWebhook: ({ header, secret, url, params }) =>
    Boolean(url && params && verifyTwilioSignature(secret, url, params, header)),
  async send(creds, input: SendInput): Promise<SendResult> {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: input.to,
        From: creds.from,
        Body: input.body.slice(0, 1500),
        ...(inboxSmsWebhookUrl() ? { StatusCallback: inboxSmsWebhookUrl()! } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok || !data.sid) {
      throw new ChannelSendError(data.message ?? `SMS send failed: HTTP ${response.status}`, response.status >= 500);
    }
    return { providerMessageId: data.sid };
  },
};

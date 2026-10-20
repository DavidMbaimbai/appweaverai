import { createHmac, timingSafeEqual } from 'node:crypto';

import { windowBlockReason } from '../gates';
import type { InboundMessage, MessageChannelName, StatusUpdate } from '../types';
import { ChannelSendError, type ChannelAdapter, type SendInput, type SendResult } from './types';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Verifies Meta's X-Hub-Signature-256 over the raw body (same scheme for WhatsApp, Messenger and Instagram). */
export function verifyMetaHubSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const actual = Buffer.from(header.slice('sha256='.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  delivery?: { mids?: string[] };
};
type MessagingPayload = { object?: string; entry?: Array<{ id?: string; messaging?: MessagingEvent[] }> };

/** Parses Messenger (object "page") and Instagram DM (object "instagram") events. Echoes of our own messages are dropped. */
export function parseMetaMessaging(payload: unknown): InboundMessage[] {
  const data = payload as MessagingPayload;
  const channel: MessageChannelName | null = data?.object === 'page' ? 'FACEBOOK' : data?.object === 'instagram' ? 'INSTAGRAM' : null;
  if (!channel) return [];
  const out: InboundMessage[] = [];
  for (const entry of data.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      const senderId = event.sender?.id;
      if (!message?.mid || !senderId || message.is_echo || senderId === entry.id) continue;
      const attachments = (message.attachments ?? []).map((a) => ({ type: a.type ?? 'file', url: a.payload?.url }));
      const body = message.text?.trim() || (attachments.length ? `[${attachments[0].type} attachment]` : '');
      if (!body) continue;
      out.push({
        channel,
        providerMessageId: message.mid,
        externalThreadId: senderId,
        contactRef: senderId,
        body,
        attachments: attachments.length ? attachments : undefined,
        accountId: entry.id ?? event.recipient?.id,
        receivedAt: event.timestamp ? new Date(event.timestamp) : undefined,
      });
    }
  }
  return out;
}

export function parseMetaMessagingStatus(payload: unknown): StatusUpdate[] {
  const data = payload as MessagingPayload;
  const channel: MessageChannelName | null = data?.object === 'page' ? 'FACEBOOK' : data?.object === 'instagram' ? 'INSTAGRAM' : null;
  if (!channel) return [];
  return (data.entry ?? []).flatMap((entry) =>
    (entry.messaging ?? []).flatMap((e) =>
      (e.delivery?.mids ?? []).map((mid): StatusUpdate => ({ channel, providerMessageId: mid, status: 'DELIVERED', eventId: `${mid}:delivered` })),
    ),
  );
}

type MetaCreds = { accountId: string; accessToken: string };

function makeMetaAdapter(channel: 'FACEBOOK' | 'INSTAGRAM'): ChannelAdapter<MetaCreds> {
  return {
    channel,
    verifyWebhook: ({ rawBody, header, secret }) => verifyMetaHubSignature(rawBody, header, secret),
    parseStatus: parseMetaMessagingStatus,
    async send(creds: MetaCreds, input: SendInput): Promise<SendResult> {
      const blocked = windowBlockReason({ channel, lastInboundAt: input.lastInboundAt, now: input.now ?? new Date() });
      if (blocked) throw new ChannelSendError(blocked);
      const response = await fetch(`${GRAPH}/${encodeURIComponent(creds.accountId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: input.to },
          messaging_type: 'RESPONSE',
          message: { text: input.body.slice(0, 1000) },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await response.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
      if (!response.ok || !data.message_id) {
        throw new ChannelSendError(data.error?.message ?? `${channel} send failed: HTTP ${response.status}`, response.status >= 500);
      }
      return { providerMessageId: data.message_id };
    },
  };
}

export const facebookAdapter = makeMetaAdapter('FACEBOOK');
export const instagramAdapter = makeMetaAdapter('INSTAGRAM');

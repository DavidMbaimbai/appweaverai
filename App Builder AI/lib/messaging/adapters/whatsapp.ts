import { windowBlockReason } from '../gates';
import { safeEqual } from '../safe-equal';
import type { InboundMessage, StatusUpdate } from '../types';
import { verifyMetaHubSignature } from './meta';
import { ChannelSendError, type ChannelAdapter, type SendInput, type SendResult } from './types';

export const GRAPH = 'https://graph.facebook.com/v21.0';

type WaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string; caption?: string };
};
type WaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WaMessage[];
  statuses?: Array<{ id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number | string; title?: string; message?: string }> }>;
};
type WaPayload = { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: WaValue }> }> };

function values(payload: unknown): WaValue[] {
  const data = payload as WaPayload;
  if (data?.object !== 'whatsapp_business_account') return [];
  return (data.entry ?? []).flatMap((e) => (e.changes ?? []).filter((c) => c.field === 'messages' && c.value).map((c) => c.value!));
}

function bodyOf(m: WaMessage): { body: string; attachments?: InboundMessage['attachments'] } {
  const media = m.image ?? m.document ?? m.video;
  const mediaId = (media ?? m.audio)?.id;
  const text =
    m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? media?.caption ?? '';
  const attachments = mediaId ? [{ type: m.type ?? 'file', id: mediaId }] : undefined;
  return { body: text.trim() || (attachments ? `[${m.type} attachment]` : ''), attachments };
}

/** Parses WhatsApp Business Cloud API webhook payloads into inbound messages. */
export function parseWhatsAppInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const value of values(payload)) {
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
    for (const m of value.messages ?? []) {
      if (!m.id || !m.from) continue;
      const { body, attachments } = bodyOf(m);
      if (!body) continue;
      out.push({
        channel: 'WHATSAPP',
        providerMessageId: m.id,
        externalThreadId: m.from,
        contactRef: m.from.startsWith('+') ? m.from : `+${m.from}`,
        contactName: names.get(m.from),
        body,
        attachments,
        accountId: value.metadata?.phone_number_id,
        receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
      });
    }
  }
  return out;
}

export function parseWhatsAppStatus(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const value of values(payload)) {
    for (const s of value.statuses ?? []) {
      if (!s.id) continue;
      const status = s.status === 'sent' ? 'SENT' : s.status === 'delivered' ? 'DELIVERED' : s.status === 'read' ? 'READ' : s.status === 'failed' ? 'FAILED' : null;
      if (status) {
        out.push({
          channel: 'WHATSAPP',
          providerMessageId: s.id,
          status,
          eventId: `${s.id}:${s.status}`,
          errorCode: s.errors?.[0]?.code !== undefined ? String(s.errors[0].code) : undefined,
          error: s.errors?.[0]?.message ?? s.errors?.[0]?.title,
        });
      }
    }
  }
  return out;
}

/** GET handshake: returns the challenge only when mode and verify token match. */
export function whatsAppVerifyChallenge(query: URLSearchParams, expectedToken: string | undefined): string | null {
  if (!expectedToken) return null;
  if (query.get('hub.mode') !== 'subscribe' || !safeEqual(query.get('hub.verify_token'), expectedToken)) return null;
  return query.get('hub.challenge') ?? '';
}

export type WhatsAppSendCredentials = { accessToken: string; phoneNumberId: string; approvedTemplates: string[] };

export const whatsappAdapter: ChannelAdapter<WhatsAppSendCredentials> = {
  channel: 'WHATSAPP',
  verifyWebhook: ({ rawBody, header, secret }) => verifyMetaHubSignature(rawBody, header, secret),
  parseStatus: parseWhatsAppStatus,
  async send(creds, input: SendInput): Promise<SendResult> {
    const blocked = windowBlockReason({
      channel: 'WHATSAPP',
      lastInboundAt: input.lastInboundAt,
      now: input.now ?? new Date(),
      template: input.template,
      approvedTemplates: creds.approvedTemplates,
    });
    if (blocked) throw new ChannelSendError(blocked);

    const to = input.to.replace(/^\+/, '');
    const payload = input.template
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: input.template.name,
            language: { code: input.template.language },
            ...(input.template.variables?.length
              ? { components: [{ type: 'body', parameters: input.template.variables.map((text) => ({ type: 'text', text })) }] }
              : {}),
          },
        }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: input.body.slice(0, 4000), preview_url: false } };

    const response = await fetch(`${GRAPH}/${encodeURIComponent(creds.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    const id = data.messages?.[0]?.id;
    if (!response.ok || !id) {
      throw new ChannelSendError(data.error?.message ?? `WhatsApp send failed: HTTP ${response.status}`, response.status >= 500);
    }
    return { providerMessageId: id };
  },
};

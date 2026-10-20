import { randomUUID } from 'node:crypto';

import type { InboundMessage } from '../types';
import type { ChannelAdapter, SendInput, SendResult } from './types';

const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;

export const isValidVisitorId = (v: unknown): v is string => typeof v === 'string' && VISITOR_ID.test(v);

/** The visitor id is an unguessable bearer secret: whoever holds it can read that one thread. */
export function parseWebchatInbound(
  projectId: string,
  input: { visitorId?: unknown; text?: unknown; name?: unknown; messageId?: unknown },
): InboundMessage | null {
  if (!isValidVisitorId(input.visitorId) || typeof input.text !== 'string') return null;
  const body = input.text.trim().slice(0, 2000);
  if (!body) return null;
  const messageId = typeof input.messageId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(input.messageId) ? input.messageId : randomUUID();
  return {
    channel: 'WEBCHAT',
    providerMessageId: `${input.visitorId}:${messageId}`,
    externalThreadId: input.visitorId,
    contactRef: input.visitorId,
    contactName: typeof input.name === 'string' ? input.name.trim().slice(0, 80) || undefined : undefined,
    body,
    accountId: projectId,
  };
}

/** Webchat has no external provider: an outbound message is delivered when the widget polls the thread. */
export const webchatAdapter: ChannelAdapter<null> = {
  channel: 'WEBCHAT',
  async send(_creds, _input: SendInput): Promise<SendResult> {
    return { providerMessageId: null };
  },
};

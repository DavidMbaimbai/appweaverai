import type { MessageChannelName, StatusUpdate, TemplateMessage } from '../types';

export type SendInput = {
  /** Contact address on the channel (phone, email, page-scoped id, visitor id). */
  to: string;
  body: string;
  /** Approved template; the only thing that may be sent on WhatsApp outside the 24h window. */
  template?: TemplateMessage | null;
  /** Last inbound message time; adapters re-check the 24h window with it as a second line of defence. */
  lastInboundAt: Date | null;
  subject?: string;
  inReplyTo?: string;
  now?: Date;
};

export type SendResult = { providerMessageId: string | null };

/** Everything a channel needs to be wired into the common messaging layer. */
export type ChannelAdapter<Creds = unknown> = {
  channel: MessageChannelName;
  /** Provider signature / handshake check over the raw request; absent for polling channels (email, webchat). */
  verifyWebhook?: (request: { rawBody: string; header: string | null; secret: string; url?: string; params?: Record<string, string> }) => boolean;
  send: (credentials: Creds, input: SendInput) => Promise<SendResult>;
  /** Delivery callbacks (sent/delivered/read/failed). */
  parseStatus?: (payload: unknown) => StatusUpdate[];
};

export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

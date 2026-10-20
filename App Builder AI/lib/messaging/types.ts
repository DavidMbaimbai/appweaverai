/** Client-safe constants and types for the unified inbox (no server imports). */

export const MESSAGE_CHANNELS = ['WEBCHAT', 'EMAIL', 'WHATSAPP', 'SMS', 'FACEBOOK', 'INSTAGRAM'] as const;
export type MessageChannelName = (typeof MESSAGE_CHANNELS)[number];

export const CONVERSATION_STATUSES = ['OPEN', 'ESCALATED', 'RESOLVED'] as const;
export type ConversationStatusName = (typeof CONVERSATION_STATUSES)[number];

export const CHANNEL_LABELS: Record<MessageChannelName, string> = {
  WEBCHAT: 'Web chat',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  FACEBOOK: 'Messenger',
  INSTAGRAM: 'Instagram DM',
};

/** Customer-service window after the contact's last message; beyond it only approved templates may be sent. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Channels that enforce the 24 hour window. */
export const WINDOWED_CHANNELS: readonly MessageChannelName[] = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'];

/** Categories the AI may answer by itself (when the owner allowed autonomous replies and the answer is verified). */
export const LOW_RISK_CATEGORIES = [
  'product_info',
  'pricing',
  'docs',
  'hours',
  'booking',
  'lead_qualification',
  'troubleshooting',
  'faq',
] as const;

/** Categories that are always handed to a human; the AI only drafts. */
export const SENSITIVE_CATEGORIES = [
  'complaint',
  'refund',
  'legal',
  'security',
  'payment',
  'account_change',
  'commitment',
  'pricing_exception',
  'review',
] as const;

export const ALL_CATEGORIES = [...LOW_RISK_CATEGORIES, ...SENSITIVE_CATEGORIES, 'other'] as const;
export type MessageCategory = (typeof ALL_CATEGORIES)[number];

export function isLowRiskCategory(category: string): boolean {
  return (LOW_RISK_CATEGORIES as readonly string[]).includes(category);
}

export function isSensitiveCategory(category: string): boolean {
  return (SENSITIVE_CATEGORIES as readonly string[]).includes(category);
}

export function isMessageChannel(value: unknown): value is MessageChannelName {
  return typeof value === 'string' && (MESSAGE_CHANNELS as readonly string[]).includes(value);
}

export function isConversationStatus(value: unknown): value is ConversationStatusName {
  return typeof value === 'string' && (CONVERSATION_STATUSES as readonly string[]).includes(value);
}

/** An inbound message normalised by a channel adapter. */
export type InboundMessage = {
  channel: MessageChannelName;
  providerMessageId: string;
  /** Stable thread key per contact on the channel (phone, email, page-scoped id, visitor id). */
  externalThreadId: string;
  contactRef: string;
  contactName?: string;
  body: string;
  attachments?: Array<{ type: string; url?: string; id?: string }>;
  /** Provider account the message was sent to (phone number id, page id, Twilio number); used to find the scope. */
  accountId?: string;
  receivedAt?: Date;
  isReview?: boolean;
};

/** Delivery update reported by a provider. */
export type StatusUpdate = {
  channel: MessageChannelName;
  providerMessageId: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  /** Stable provider event id; a repeated delivery of the same event is processed once. Defaults to id:status. */
  eventId?: string;
  errorCode?: string;
  error?: string;
};

/** Approved (pre-registered) message template; required to message outside the 24h window on WhatsApp. */
export type TemplateMessage = { name: string; language: string; variables?: string[] };

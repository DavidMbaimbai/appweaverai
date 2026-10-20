import { isStopKeyword } from '@/lib/investor-hub/sms';

import {
  SESSION_WINDOW_MS,
  WINDOWED_CHANNELS,
  type MessageChannelName,
  type TemplateMessage,
} from './types';

const START_WORDS = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE']);

export { isStopKeyword };

/** Re-subscribe keywords (whole message). "YES" alone is ambiguous in a chat, so it is only honoured for a previous opt-out. */
export function isStartKeyword(text: string) {
  return START_WORDS.has(text.trim().replace(/[.!\s]+$/g, '').toUpperCase());
}

export function normalizeContact(channel: MessageChannelName, contact: string): string {
  const value = contact.trim();
  if (channel === 'EMAIL') return value.toLowerCase();
  // Phone numbers: formatting must not let a suppressed number slip through under another spelling.
  if (channel === 'SMS') return value.replace(/[\s\-().]/g, '');
  if (channel === 'WHATSAPP') return value.replace(/[\s\-().+]/g, '');
  return value;
}

export type WindowInput = {
  channel: MessageChannelName;
  lastInboundAt: Date | null;
  now: Date;
  template?: TemplateMessage | null;
  /** Template names approved by Meta for this account. */
  approvedTemplates?: readonly string[];
};

/**
 * Enforces the 24h customer-service window on WhatsApp, Messenger and Instagram.
 * Returns why the send must be refused, or null when allowed. Free-form text is never allowed outside
 * the window; only WhatsApp templates that are on the approved list may be sent.
 */
export function windowBlockReason(input: WindowInput): string | null {
  if (!WINDOWED_CHANNELS.includes(input.channel)) return null;
  const inside =
    input.lastInboundAt !== null && input.now.getTime() - input.lastInboundAt.getTime() < SESSION_WINDOW_MS;
  if (inside) return null;

  if (input.channel !== 'WHATSAPP') {
    return 'The 24 hour messaging window has closed. Wait for the contact to message you again.';
  }
  if (!input.template) {
    return 'The 24 hour WhatsApp window has closed: only an approved message template can be sent, not free-form text.';
  }
  if (!input.approvedTemplates?.includes(input.template.name)) {
    return `Template "${input.template.name}" is not on the approved template list.`;
  }
  return null;
}

export type ConsentRecord = { optIn: boolean; optOut: boolean } | null;

/** Why this send is refused because the contact is on the suppression list, or null. */
export function suppressionBlockReason(suppressed: { reason: string } | null): string | null {
  return suppressed ? `This contact is on the suppression list (${suppressed.reason}). Nothing is sent until they opt back in.` : null;
}

export type ConsentProofRecord = { source: string; proof: string; capturedAt: Date } | null;

/** What a message is for: replies to a customer's own message are conversational; everything else needs recorded opt-in proof. */
export type MessagePurpose = 'conversation' | 'marketing' | 'lead';

/** Marketing and lead messages need an opt-in with a source, proof text and timestamp (the contact writing first is not enough). */
export function marketingConsentBlockReason(proof: ConsentProofRecord, now: Date = new Date()): string | null {
  if (!proof) return 'No recorded opt-in for marketing messages: source, proof and timestamp are required.';
  if (!proof.source.trim() || !proof.proof.trim()) return 'The opt-in record is incomplete: it needs a source and proof of what the contact agreed to.';
  if (Number.isNaN(proof.capturedAt.getTime()) || proof.capturedAt.getTime() > now.getTime() + 60_000) {
    return 'The opt-in record has no valid timestamp.';
  }
  return null;
}

/** Returns why an outbound message must not be sent to the contact, or null when it may be. */
export function consentBlockReason(
  channel: MessageChannelName,
  record: ConsentRecord,
  contactMessagedFirst: boolean,
): string | null {
  if (record?.optOut) return 'This contact opted out of messages on this channel.';
  if ((channel === 'SMS' || channel === 'WHATSAPP') && !record?.optIn && !contactMessagedFirst) {
    return 'No recorded opt-in for this contact, and they have not messaged first.';
  }
  return null;
}

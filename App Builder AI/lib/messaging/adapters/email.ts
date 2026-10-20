import { sendEmail } from '@/lib/email';

import type { InboundMessage } from '../types';
import { ChannelSendError, type ChannelAdapter, type SendInput, type SendResult } from './types';

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type ParsedEmail = {
  messageId?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  subject?: string | null;
  text?: string | null;
};

/** Normalises a parsed email (from the existing support mailbox poller) into an inbound message. */
export function parseEmailInbound(mail: ParsedEmail, accountId = 'support'): InboundMessage | null {
  const from = mail.fromAddress?.trim().toLowerCase();
  if (!from || !mail.messageId) return null;
  const subject = mail.subject?.trim();
  return {
    channel: 'EMAIL',
    providerMessageId: mail.messageId,
    externalThreadId: from,
    contactRef: from,
    contactName: mail.fromName?.trim() || undefined,
    body: [subject ? `Subject: ${subject}` : '', mail.text?.trim() ?? ''].filter(Boolean).join('\n\n').slice(0, 8000),
    accountId,
  };
}

/** Sends through the app's SMTP transport (the same one the support inbox uses). */
export const emailAdapter: ChannelAdapter<null> = {
  channel: 'EMAIL',
  async send(_creds, input: SendInput): Promise<SendResult> {
    const subject = input.subject?.trim() || 'Your message';
    try {
      await sendEmail({
        to: input.to,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        text: input.body,
        html: `<div style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(input.body)}</div>`,
        inReplyTo: input.inReplyTo,
        headers: { 'Auto-Submitted': 'auto-replied' },
      });
    } catch (error) {
      throw new ChannelSendError(error instanceof Error ? error.message : 'Email send failed', true);
    }
    return { providerMessageId: null };
  },
};

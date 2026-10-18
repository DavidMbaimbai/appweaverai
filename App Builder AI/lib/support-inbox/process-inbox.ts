import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { sendEmail } from '@/lib/email';
import { shouldAutoReply } from '@/lib/support-inbox/filters';
import { generateSupportReply } from '@/lib/support-inbox/reply';

const MAX_PER_RUN = 20;

export const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL?.trim() || 'david.mbaimbai@appweaverai.com';

export function isInboxConfigured() {
  return Boolean(
    process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD,
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export type InboxResult = {
  replied: number;
  escalated: number;
  skipped: number;
  failed: number;
};

/**
 * Polls the support mailbox over IMAP and answers every unread message with an
 * AI-generated reply. Replied messages get \Answered + \Seen; skipped
 * (auto-generated) mail gets \Seen; failures stay unread so the next run
 * retries; messages needing a human are additionally \Flagged.
 */
export async function processSupportInbox(): Promise<InboxResult> {
  const result: InboxResult = { replied: 0, escalated: 0, skipped: 0, failed: 0 };

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: process.env.IMAP_SECURE !== 'false',
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    const ownAddresses = [
      SUPPORT_EMAIL,
      process.env.SMTP_USER ?? '',
      process.env.IMAP_USER ?? '',
    ];

    for (const uid of uids.slice(0, MAX_PER_RUN)) {
      try {
        const message = await client.fetchOne(
          String(uid),
          { source: true },
          { uid: true },
        );
        if (!message || !message.source) continue;

        const parsed = await simpleParser(message.source);
        const sender = parsed.from?.value[0];

        const decision = shouldAutoReply({
          fromAddress: sender?.address,
          ownAddresses,
          headers: parsed.headers,
        });

        if (!decision.reply || !sender?.address) {
          result.skipped += 1;
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          continue;
        }

        const subject = parsed.subject?.trim() || '(no subject)';
        const { reply, escalate } = await generateSupportReply({
          fromName: sender.name || undefined,
          subject,
          body: parsed.text?.trim() || '(empty message)',
        });

        const references = [
          ...(Array.isArray(parsed.references)
            ? parsed.references
            : parsed.references
              ? [parsed.references]
              : []),
          ...(parsed.messageId ? [parsed.messageId] : []),
        ];

        await sendEmail({
          to: sender.address,
          subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
          text: reply,
          html: `<div style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(reply)}</div>`,
          inReplyTo: parsed.messageId,
          references,
          headers: { 'Auto-Submitted': 'auto-replied' },
        });

        const flags = escalate
          ? ['\\Seen', '\\Answered', '\\Flagged']
          : ['\\Seen', '\\Answered'];
        await client.messageFlagsAdd(String(uid), flags, { uid: true });

        result.replied += 1;
        if (escalate) result.escalated += 1;
      } catch (error) {
        result.failed += 1;
        console.error(`[support-inbox] failed to process uid ${uid}:`, error);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return result;
}

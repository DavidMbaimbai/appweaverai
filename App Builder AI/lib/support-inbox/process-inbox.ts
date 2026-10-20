import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { sendEmail } from '@/lib/email';
import { handleCampaignInbound } from '@/lib/investor-hub/campaign-inbound';
import { mirrorInboundEmail, mirrorOutboundEmail } from '@/lib/messaging/email-mirror';
import { suppress } from '@/lib/outreach/process';
import { rateLimit } from '@/lib/rate-limit';
import { shouldAutoReply, REVIEW_NOTE } from '@/lib/support-inbox/filters';
import { generateSupportReply } from '@/lib/support-inbox/reply';

const MAX_PER_RUN = 20;
// Replies below this confidence are not sent; a human reviews them instead.
const MIN_CONFIDENCE = Number(process.env.SUPPORT_MIN_CONFIDENCE ?? 0.6);
// Hard cap per sender per day: stops ping-pong loops with other auto-responders.
const MAX_REPLIES_PER_SENDER_PER_DAY = 3;
// IMAP keyword marking mail waiting for human review (kept unread, skipped by the poller).
const REVIEW_KEYWORD = 'AWReview';

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
  held: number;
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
  const result: InboxResult = { replied: 0, escalated: 0, held: 0, skipped: 0, failed: 0 };

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
    const uids =
      (await client.search({ seen: false, unKeyword: REVIEW_KEYWORD }, { uid: true })) || [];
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

        // Replies/bounces for investor campaigns are logged for the owner and never auto-answered.
        const campaign = await handleCampaignInbound({ from: sender?.address, subject: parsed.subject, body: parsed.text });
        if (campaign.handled) {
          await client.messageFlagsAdd(String(uid), campaign.needsHuman ? ['\\Seen', '\\Flagged'] : ['\\Seen'], { uid: true });
          result.held += 1;
          continue;
        }

        const decision = shouldAutoReply({
          fromAddress: sender?.address,
          ownAddresses,
          headers: parsed.headers,
          subject: parsed.subject,
          body: parsed.text,
        });

        // Mirror into the unified inbox (record only; this mailbox keeps its own reply engine).
        await mirrorInboundEmail(
          { messageId: parsed.messageId, fromAddress: sender?.address, fromName: sender?.name, subject: parsed.subject, text: parsed.text },
          decision.reason === REVIEW_NOTE,
        );

        if (!decision.reply || !sender?.address) {
          // Reviews are never AI-answered; flag them so a human sees them.
          if (decision.reason === REVIEW_NOTE) {
            result.held += 1;
            await client.messageFlagsAdd(String(uid), ['\\Seen', '\\Flagged'], { uid: true });
            continue;
          }
          result.skipped += 1;
          // Someone telling us to stop must also never get investor outreach.
          if (decision.reason === 'stop request' && sender?.address) {
            await suppress(sender.address, 'replied with a stop request').catch((error) =>
              console.error('[support-inbox] failed to record suppression:', error),
            );
          }
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          continue;
        }

        const senderLimit = await rateLimit(
          `support-reply:${sender.address.toLowerCase()}`,
          MAX_REPLIES_PER_SENDER_PER_DAY,
          24 * 60 * 60 * 1000,
        );
        if (!senderLimit.ok) {
          result.skipped += 1;
          await client.messageFlagsAdd(String(uid), ['\\Seen', '\\Flagged'], { uid: true });
          continue;
        }

        const subject = parsed.subject?.trim() || '(no subject)';
        const { reply, escalate, confidence } = await generateSupportReply({
          fromName: sender.name || undefined,
          subject,
          body: parsed.text?.trim() || '(empty message)',
        });

        if (!escalate && confidence < MIN_CONFIDENCE) {
          result.held += 1;
          await client.messageFlagsAdd(String(uid), ['\\Flagged', REVIEW_KEYWORD], {
            uid: true,
          });
          continue;
        }

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
        await mirrorOutboundEmail(sender.address, reply, /^re:/i.test(subject) ? subject : `Re: ${subject}`, true);

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

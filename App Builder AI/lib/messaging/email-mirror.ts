import { scopeId } from '@/lib/agents/types';
import { prisma } from '@/lib/prisma';

import { parseEmailInbound, type ParsedEmail } from './adapters/email';
import { ingestInbound } from './ingest';
import { normalizeContact } from './gates';

/**
 * Best-effort mirror of the support mailbox into the unified inbox (PLATFORM scope). The support mailbox keeps
 * its own reply engine, so this only records messages: it never triggers a second AI reply. Never throws.
 */
export async function mirrorInboundEmail(mail: ParsedEmail, isReview: boolean) {
  try {
    const msg = parseEmailInbound(mail);
    if (!msg) return;
    await ingestInbound({ type: 'PLATFORM' }, { ...msg, isReview });
  } catch (error) {
    console.error('[inbox] email mirror (inbound) failed:', error instanceof Error ? error.message : error);
  }
}

export async function mirrorOutboundEmail(to: string, body: string, subject: string, aiGenerated: boolean) {
  try {
    const thread = normalizeContact('EMAIL', to);
    const conversation = await prisma.conversation.findFirst({
      where: { scopeType: 'PLATFORM', scopeId: scopeId({ type: 'PLATFORM' }), channel: 'EMAIL', externalThreadId: thread },
      select: { id: true },
    });
    if (!conversation) return;
    await prisma.inboxMessage.create({
      data: {
        conversationId: conversation.id,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        body: `${subject}\n\n${body}`.slice(0, 8000),
        aiGenerated,
        deliveryStatus: 'SENT',
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  } catch (error) {
    console.error('[inbox] email mirror (outbound) failed:', error instanceof Error ? error.message : error);
  }
}

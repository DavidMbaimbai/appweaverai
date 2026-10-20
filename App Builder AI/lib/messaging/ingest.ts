import { scopeId, type AgentScope } from '@/lib/agents/types';
import { prisma } from '@/lib/prisma';

import { recordConsent, getConsent } from './consent';
import { isStartKeyword, isStopKeyword, normalizeContact } from './gates';
import { respondToMessage, type RespondResult } from './respond';
import type { InboundMessage, StatusUpdate } from './types';

export type IngestResult =
  | { duplicate: true }
  | { duplicate: false; conversationId: string; messageId: string; optOut?: boolean; humanTakeover: boolean };

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === 'P2002';

/**
 * Stores one inbound message. Idempotent: the provider message id is unique per channel, so a retried
 * webhook returns `duplicate: true` and changes nothing.
 */
export async function ingestInbound(scope: AgentScope, msg: InboundMessage): Promise<IngestResult> {
  const sid = scopeId(scope);
  const thread = normalizeContact(msg.channel, msg.externalThreadId);
  const at = msg.receivedAt ?? new Date();
  const base = { scopeType: scope.type, scopeId: sid, channel: msg.channel, externalThreadId: thread };

  let conversation = await prisma.conversation.findFirst({ where: base });
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: {
          ...base,
          contactRef: normalizeContact(msg.channel, msg.contactRef),
          contactName: msg.contactName,
          isReview: msg.isReview ?? false,
          lastMessageAt: at,
          lastInboundAt: at,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      conversation = await prisma.conversation.findFirst({ where: base });
    }
  }
  if (!conversation) throw new Error('Could not open conversation.');

  let messageId: string;
  try {
    const created = await prisma.inboxMessage.create({
      data: {
        conversationId: conversation.id,
        channel: msg.channel,
        direction: 'INBOUND',
        body: msg.body.slice(0, 8000),
        attachments: msg.attachments ? JSON.parse(JSON.stringify(msg.attachments)) : undefined,
        providerMessageId: msg.providerMessageId,
      },
      select: { id: true },
    });
    messageId = created.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }

  const newest = !conversation.lastInboundAt || at > conversation.lastInboundAt;
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: newest ? at : undefined,
      lastInboundAt: newest ? at : undefined,
      contactName: conversation.contactName ?? msg.contactName,
      isReview: msg.isReview ? true : undefined,
      status: conversation.status === 'RESOLVED' ? 'OPEN' : undefined,
    },
  });

  let optOut: boolean | undefined;
  if (msg.channel === 'SMS' || msg.channel === 'WHATSAPP') {
    if (isStopKeyword(msg.body)) {
      await recordConsent(scope, msg.channel, msg.contactRef, { optOut: true, source: 'inbound_stop' });
      optOut = true;
    } else if (isStartKeyword(msg.body)) {
      const existing = await getConsent(scope, msg.channel, msg.contactRef);
      if (existing?.optOut) await recordConsent(scope, msg.channel, msg.contactRef, { optIn: true, source: 'inbound_start' });
    }
  }

  return { duplicate: false, conversationId: conversation.id, messageId, optOut, humanTakeover: conversation.humanTakeover };
}

/** Ingests and, unless the contact opted out or a human took over, runs the response pipeline. Never throws. */
export async function handleInbound(
  scope: AgentScope,
  msg: InboundMessage,
): Promise<{ ingest: IngestResult; respond?: RespondResult }> {
  const ingest = await ingestInbound(scope, msg);
  if (ingest.duplicate || ingest.optOut || ingest.humanTakeover) return { ingest };
  try {
    return { ingest, respond: await respondToMessage(ingest.conversationId, ingest.messageId) };
  } catch (error) {
    console.error('[inbox] respond failed:', error instanceof Error ? error.message : error);
    return { ingest };
  }
}

/**
 * Applies provider delivery receipts. Each provider event is recorded once (unique channel+eventId), so retried
 * webhooks have no second effect. Receipts only move forward (SENT < DELIVERED < READ); FAILED never overrides
 * DELIVERED/READ. QUEUED is audit-only (recorded as an event, never written to the message).
 */
export async function applyStatusUpdates(updates: StatusUpdate[]) {
  const rank = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 1 } as const;
  for (const u of updates) {
    const row = await prisma.inboxMessage.findUnique({
      where: { channel_providerMessageId: { channel: u.channel, providerMessageId: u.providerMessageId } },
      select: { id: true, direction: true, deliveryStatus: true },
    });
    // Unknown message (e.g. receipt raced the send): not recorded, so the provider's retry can still apply it.
    if (!row || row.direction !== 'OUTBOUND') continue;
    try {
      await prisma.messageStatusEvent.create({
        data: {
          channel: u.channel,
          eventId: (u.eventId ?? `${u.providerMessageId}:${u.status}`).slice(0, 200),
          providerMessageId: u.providerMessageId,
          status: u.status,
          errorCode: u.errorCode?.slice(0, 50),
          errorMessage: u.error?.slice(0, 500),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
    if (u.status === 'QUEUED') continue;
    const current = row.deliveryStatus;
    if (u.status === 'FAILED') {
      if (current === 'DELIVERED' || current === 'READ') continue;
    } else if (current && rank[current] >= rank[u.status]) {
      continue;
    }
    const detail = u.error ?? (u.errorCode ? `Error ${u.errorCode}` : undefined);
    await prisma.inboxMessage.update({
      where: { id: row.id },
      data: { deliveryStatus: u.status, error: u.status === 'FAILED' ? detail?.slice(0, 500) : undefined },
    });
  }
}

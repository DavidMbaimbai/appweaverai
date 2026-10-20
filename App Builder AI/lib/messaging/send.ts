import { randomUUID } from 'node:crypto';

import { scopeId, type AgentScope } from '@/lib/agents/types';
import { withScopeMarketing } from '@/lib/marketing-credits/system';
import { prisma } from '@/lib/prisma';

import { getAdapter } from './adapters';
import { getCredentials } from './connections';
import { getConsent } from './consent';
import { consentBlockReason, windowBlockReason } from './gates';
import type { MessageChannelName, TemplateMessage } from './types';

export type SendOutboundInput = {
  conversationId: string;
  /** When given, the conversation must belong to this scope (cross-tenant guard). */
  scope?: AgentScope;
  body: string;
  template?: TemplateMessage | null;
  aiGenerated?: boolean;
  agentActivityId?: string | null;
  /** Existing draft to send; it is claimed atomically so it can never go out twice. */
  draftId?: string;
  category?: string | null;
  sources?: unknown;
};

export type SendOutboundResult =
  | { ok: true; messageId: string; alreadySent?: boolean }
  | { ok: false; error: string; blocked: boolean };

const scopeOf = (c: { scopeType: 'PLATFORM' | 'PROJECT'; scopeId: string }): AgentScope =>
  c.scopeType === 'PLATFORM' ? { type: 'PLATFORM' } : { type: 'PROJECT', projectId: c.scopeId };

/**
 * The only way a message leaves the system. Honours opt-outs and the 24h window before any provider call,
 * so it applies equally to AI replies, human replies and approved drafts.
 * SMS and WhatsApp are passthrough-priced: marketing credits are reserved first, refunded when nothing was sent,
 * and the platform's own (PLATFORM scope) sends only log an internal cost.
 */
export async function sendOutbound(input: SendOutboundInput): Promise<SendOutboundResult> {
  const conversation = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  const operation = conversation?.channel === 'SMS' ? 'sms' : conversation?.channel === 'WHATSAPP' ? 'whatsapp' : null;
  if (!conversation || !operation) return deliverOutbound(input);
  if (input.scope && (conversation.scopeType !== input.scope.type || conversation.scopeId !== scopeId(input.scope))) {
    return deliverOutbound(input);
  }

  const outcome = await withScopeMarketing(
    {
      scope: scopeOf(conversation),
      operation,
      params: { units: operation === 'sms' ? Math.max(1, Math.ceil(input.body.length / 160)) : 1 },
      idempotencyKey: `msg:${input.draftId ?? `${conversation.id}:${randomUUID()}`}`,
      retryable: true,
      refType: 'conversation',
      refId: conversation.id,
      isFailure: (r: SendOutboundResult) => !r.ok || r.alreadySent === true,
    },
    () => deliverOutbound(input),
  );
  if (outcome.ok) return outcome.value;
  if (outcome.reason === 'duplicate') return { ok: true, messageId: input.draftId ?? '', alreadySent: true };
  const error = outcome.insufficient ? `blocked: insufficient credits. ${outcome.error}` : outcome.error;
  if (input.draftId) {
    await prisma.inboxMessage
      .updateMany({ where: { id: input.draftId, isDraft: true }, data: { error: error.slice(0, 500) } })
      .catch(() => undefined);
  }
  return { ok: false, error, blocked: true };
}

async function deliverOutbound(input: SendOutboundInput): Promise<SendOutboundResult> {
  const conversation = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  if (!conversation) return { ok: false, error: 'Conversation not found.', blocked: true };
  if (input.scope && (conversation.scopeType !== input.scope.type || conversation.scopeId !== scopeId(input.scope))) {
    return { ok: false, error: 'Conversation not found.', blocked: true };
  }
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Message is empty.', blocked: true };

  const scope = scopeOf(conversation);
  const channel = conversation.channel as MessageChannelName;
  const now = new Date();

  const creds = channel === 'WEBCHAT' || channel === 'EMAIL' ? null : await getCredentials(scope, channel);
  if (channel !== 'WEBCHAT' && channel !== 'EMAIL' && !creds) {
    return { ok: false, error: `${channel} is not configured for this scope.`, blocked: true };
  }

  const consent = await getConsent(scope, channel, conversation.contactRef);
  const consentReason = consentBlockReason(channel, consent, conversation.lastInboundAt !== null);
  if (consentReason) return { ok: false, error: consentReason, blocked: true };

  const approved = creds && 'approvedTemplates' in creds ? creds.approvedTemplates : [];
  const windowReason = windowBlockReason({
    channel,
    lastInboundAt: conversation.lastInboundAt,
    now,
    template: input.template,
    approvedTemplates: approved,
  });
  if (windowReason) return { ok: false, error: windowReason, blocked: true };

  if (input.draftId) {
    const claimed = await prisma.inboxMessage.updateMany({
      where: { id: input.draftId, conversationId: conversation.id, isDraft: true },
      data: { isDraft: false, body },
    });
    if (claimed.count === 0) return { ok: true, messageId: input.draftId, alreadySent: true };
  }

  let providerMessageId: string | null = null;
  try {
    const lastInbound = await prisma.inboxMessage.findFirst({
      where: { conversationId: conversation.id, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { body: true, providerMessageId: true },
    });
    const subject = lastInbound?.body.match(/^Subject:\s*(.+)$/m)?.[1];
    const result = await getAdapter(channel).send((creds ?? null) as never, {
      to: conversation.contactRef,
      body,
      template: input.template,
      lastInboundAt: conversation.lastInboundAt,
      subject,
      inReplyTo: channel === 'EMAIL' ? (lastInbound?.providerMessageId ?? undefined) : undefined,
      now,
    });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Send failed').slice(0, 500);
    if (input.draftId) {
      await prisma.inboxMessage.update({ where: { id: input.draftId }, data: { isDraft: true, error: message } });
    } else {
      await prisma.inboxMessage.create({
        data: {
          conversationId: conversation.id,
          channel,
          direction: 'OUTBOUND',
          body,
          deliveryStatus: 'FAILED',
          aiGenerated: input.aiGenerated ?? false,
          agentActivityId: input.agentActivityId ?? undefined,
          error: message,
        },
      });
    }
    return { ok: false, error: message, blocked: false };
  }

  const data = {
    providerMessageId,
    deliveryStatus: 'SENT' as const,
    error: null,
    isDraft: false,
    ...(input.agentActivityId ? { agentActivityId: input.agentActivityId } : {}),
  };
  const message = input.draftId
    ? await prisma.inboxMessage.update({ where: { id: input.draftId }, data })
    : await prisma.inboxMessage.create({
        data: {
          conversationId: conversation.id,
          channel,
          direction: 'OUTBOUND',
          body,
          aiGenerated: input.aiGenerated ?? false,
          category: input.category ?? undefined,
          sources: input.sources === undefined ? undefined : JSON.parse(JSON.stringify(input.sources)),
          ...data,
        },
      });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } });
  return { ok: true, messageId: message.id };
}

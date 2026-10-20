import { scopeId, type AgentScope } from '@/lib/agents/types';
import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { sendOutbound, type SendOutboundResult } from './send';
import type { ConversationStatusName, MessageChannelName, TemplateMessage } from './types';

const scopeWhere = (scope: AgentScope) => ({ scopeType: scope.type, scopeId: scopeId(scope) });

export type ConversationFilters = {
  status?: ConversationStatusName;
  channel?: MessageChannelName;
  q?: string;
  takeover?: boolean;
};

/** Every query is restricted to one scope, so a project owner can never read platform or other projects' threads. */
export async function listConversations(scope: AgentScope, filters: ConversationFilters = {}, take = 100) {
  const where: Prisma.ConversationWhereInput = {
    ...scopeWhere(scope),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.takeover ? { humanTakeover: true } : {}),
    ...(filters.q
      ? {
          OR: [
            { contactName: { contains: filters.q, mode: 'insensitive' } },
            { summary: { contains: filters.q, mode: 'insensitive' } },
            { contactRef: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  return prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take,
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, direction: true, isDraft: true } } },
  });
}

export async function getConversation(scope: AgentScope, id: string) {
  return prisma.conversation.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 300 } },
  });
}

async function owned(scope: AgentScope, id: string) {
  return prisma.conversation.findFirst({ where: { id, ...scopeWhere(scope) }, select: { id: true } });
}

/** Sends a human-written or human-approved reply. Edits to an AI draft are sent as written. */
export async function sendHumanReply(
  scope: AgentScope,
  conversationId: string,
  input: { body: string; draftId?: string; template?: TemplateMessage | null; actorId: string },
): Promise<SendOutboundResult> {
  if (!(await owned(scope, conversationId))) return { ok: false, error: 'Conversation not found.', blocked: true };
  const draft = input.draftId
    ? await prisma.inboxMessage.findFirst({ where: { id: input.draftId, conversationId, isDraft: true } })
    : null;
  const result = await sendOutbound({
    conversationId,
    scope,
    body: input.body,
    draftId: draft?.id,
    template: input.template,
    aiGenerated: Boolean(draft?.aiGenerated),
    category: draft?.category,
    sources: draft?.sources,
  });
  if (result.ok && draft?.agentActivityId) {
    await prisma.agentActivity.updateMany({
      where: { id: draft.agentActivityId, status: { in: ['AWAITING_APPROVAL', 'PLANNED'] } },
      data: { status: 'DONE', decidedBy: input.actorId, decidedAt: new Date(), resultSummary: 'Sent by a person from the inbox.' },
    });
  }
  if (result.ok) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { assignedTo: input.actorId } });
  }
  return result;
}

export async function discardDraft(scope: AgentScope, conversationId: string, draftId: string) {
  if (!(await owned(scope, conversationId))) return false;
  const draft = await prisma.inboxMessage.findFirst({ where: { id: draftId, conversationId, isDraft: true } });
  if (!draft) return false;
  await prisma.inboxMessage.delete({ where: { id: draft.id } });
  if (draft.agentActivityId) {
    await prisma.agentActivity.updateMany({
      where: { id: draft.agentActivityId, status: { in: ['AWAITING_APPROVAL', 'PLANNED'] } },
      data: { status: 'BLOCKED', resultSummary: 'Draft discarded by a person.' },
    });
  }
  return true;
}

/** Human takeover: the AI stops answering this conversation and its unsent drafts are removed. */
export async function setTakeover(scope: AgentScope, conversationId: string, on: boolean, actorId: string) {
  if (!(await owned(scope, conversationId))) return false;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { humanTakeover: on, assignedTo: on ? actorId : null },
  });
  if (on) await prisma.inboxMessage.deleteMany({ where: { conversationId, isDraft: true, aiGenerated: true } });
  return true;
}

export async function setConversationStatus(scope: AgentScope, conversationId: string, status: ConversationStatusName) {
  if (!(await owned(scope, conversationId))) return false;
  await prisma.conversation.update({ where: { id: conversationId }, data: { status } });
  return true;
}

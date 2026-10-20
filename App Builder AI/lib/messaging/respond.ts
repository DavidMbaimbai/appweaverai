import { registerAgentExecutor, runAgentAction, completeActivity } from '@/lib/agents';
import { getAgentSetting } from '@/lib/agents/settings';
import { scopeId, type AgentScope } from '@/lib/agents/types';
import { isEmail } from '@/lib/leads/logic';
import { listOpenSlots, upsertLead } from '@/lib/leads/service';
import { prisma } from '@/lib/prisma';
import { withScopeMarketing } from '@/lib/marketing-credits/system';
import { rateLimit } from '@/lib/rate-limit';
import { searchKnowledge } from '@/lib/project-reviews/retrieval';
import { sanitizeDraft } from '@/lib/project-reviews/ai';

import { analyzeMessage, draftAnswer, type Analysis, type DraftResult, type HistoryItem } from './ai';
import { loadKnowledge } from './knowledge';
import { answerGrounded, classifyHeuristic, handoffMessage, planResponse, resolveCategory, routeFor } from './plan';
import { sendOutbound } from './send';
import type { MessageChannelName } from './types';

const MIN_CONFIDENCE = 0.75;
const AI_REPLIES_PER_CONVERSATION_PER_HOUR = 20;

export type RespondDeps = {
  analyze: (input: { projectId: string | null; text: string; history: HistoryItem[] }) => Promise<Analysis>;
  draft: (input: { projectId: string | null; text: string; history: HistoryItem[]; language: string | null; hits: Array<{ id: string; title: string; content: string }> }) => Promise<DraftResult>;
};

const defaultDeps: RespondDeps = { analyze: analyzeMessage, draft: draftAnswer };

export type RespondResult =
  | { status: 'skipped'; reason: string }
  | { status: 'drafted' | 'queued' | 'sent' | 'blocked' | 'failed'; category: string; escalated: boolean; draftId: string; activityId: string };

const scopeOf = (c: { scopeType: 'PLATFORM' | 'PROJECT'; scopeId: string }): AgentScope =>
  c.scopeType === 'PLATFORM' ? { type: 'PLATFORM' } : { type: 'PROJECT', projectId: c.scopeId };

const appBase = () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://appweaverai.com').replace(/\/$/, '');

/** Approvals and retries run in other requests; this sends the stored draft. */
registerAgentExecutor('messaging.reply.send', async ({ payload }) => {
  const { messageId, conversationId } = (payload ?? {}) as { messageId?: string; conversationId?: string };
  if (!messageId || !conversationId) throw new Error('Missing draft reference.');
  const draft = await prisma.inboxMessage.findFirst({ where: { id: messageId, conversationId } });
  if (!draft) throw new Error('Draft no longer exists.');
  if (!draft.isDraft) return { summary: 'Reply was already sent.' };
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { humanTakeover: true } });
  if (conversation?.humanTakeover) throw new Error('A human took over this conversation.');
  const result = await sendOutbound({
    conversationId,
    body: draft.body,
    draftId: draft.id,
    aiGenerated: true,
    agentActivityId: draft.agentActivityId,
  });
  if (!result.ok) throw new Error(result.error);
  return { summary: `Reply sent on ${draft.channel}` };
});

/**
 * Autonomous response pipeline for one inbound message. Understands the message, answers only from the scope's own
 * knowledge, and routes the result through runAgentAction/decide() so the owner's mode and categories decide what happens.
 */
/**
 * AI replies are marketing-credit metered (engagement_reply): reserved before any model call, refunded when nothing
 * was produced. Without credits no AI runs; the conversation is escalated to a human with a top-up hint.
 */
export async function respondToMessage(conversationId: string, messageId: string, deps: RespondDeps = defaultDeps): Promise<RespondResult> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) return respondInner(conversationId, messageId, deps);
  const outcome = await withScopeMarketing(
    {
      scope: scopeOf(conv),
      operation: 'engagement_reply',
      idempotencyKey: `reply-ai:${messageId}`,
      retryable: true,
      refType: 'inbox_message',
      refId: messageId,
      isFailure: (r: RespondResult) => r.status === 'skipped',
    },
    () => respondInner(conversationId, messageId, deps),
  );
  if (outcome.ok) return outcome.value;
  if (outcome.reason === 'duplicate') return { status: 'skipped', reason: 'Already processed.' };
  const reason = outcome.insufficient ? `blocked: insufficient credits. ${outcome.error}` : outcome.error;
  if (outcome.insufficient && !conv.humanTakeover) {
    await prisma.conversation
      .update({
        where: { id: conversationId },
        data: { status: conv.status === 'OPEN' ? 'ESCALATED' : undefined, summary: reason.slice(0, 500) },
      })
      .catch(() => undefined);
  }
  return { status: 'skipped', reason };
}

async function respondInner(conversationId: string, messageId: string, deps: RespondDeps): Promise<RespondResult> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const inbound = await prisma.inboxMessage.findFirst({ where: { id: messageId, conversationId, direction: 'INBOUND' } });
  if (!conversation || !inbound) return { status: 'skipped', reason: 'Message not found.' };
  if (conversation.humanTakeover) return { status: 'skipped', reason: 'Human takeover is on.' };

  const scope = scopeOf(conversation);
  const setting = await getAgentSetting(scope, 'CUSTOMER_ENGAGEMENT');
  if (!setting.enabled || setting.paused) return { status: 'skipped', reason: 'Customer Engagement agent is off or paused.' };

  const limit = await rateLimit(`inbox-ai:${conversationId}`, AI_REPLIES_PER_CONVERSATION_PER_HOUR, 60 * 60 * 1000);
  if (!limit.ok) return { status: 'skipped', reason: 'Per-conversation AI limit reached.' };

  const projectId = scope.type === 'PROJECT' ? scope.projectId : null;
  const channel = conversation.channel as MessageChannelName;
  const recent = await prisma.inboxMessage.findMany({
    where: { conversationId, isDraft: false, id: { not: messageId } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { direction: true, body: true },
  });
  const history = recent.reverse() as HistoryItem[];

  const analysis = await deps.analyze({ projectId, text: inbound.body, history });
  const category = resolveCategory({
    modelCategory: analysis.category,
    heuristic: classifyHeuristic(inbound.body),
    isReview: conversation.isReview,
  });
  const language = analysis.language ?? conversation.language;

  const docs = await loadKnowledge(scope);
  const hits = searchKnowledge(inbound.body, docs, 4);
  const openSlots = scope.type === 'PROJECT' && category === 'booking' ? (await listOpenSlots(scope.projectId)).length : 0;
  const bookingLink = openSlots > 0 && scope.type === 'PROJECT' ? `${appBase()}/book/${scope.projectId}` : null;

  let answer: string | null = null;
  let sources: Array<{ id: string; title: string }> = [];
  let flags = analysis.flags;
  if (hits.length > 0 && category !== 'review') {
    const draft = await deps.draft({ projectId, text: inbound.body, history, language, hits });
    flags = [...new Set([...flags, ...draft.flags])];
    const cited = draft.sourceIndexes.map((i) => hits[i - 1]).filter(Boolean);
    const clean = draft.answer ? sanitizeDraft(draft.answer) : '';
    if (clean && !draft.conflict && draft.confidence >= MIN_CONFIDENCE && cited.length > 0 && answerGrounded(clean, cited.map((d) => d.content))) {
      answer = clean;
      sources = cited.map((d) => ({ id: d.id, title: d.title }));
    }
  }
  if (!answer && bookingLink) answer = 'You can pick a time that suits you here:';

  const plan = planResponse({ category, isReview: conversation.isReview, injectionFlags: flags, answer });
  const route = routeFor(plan, category, conversation.isReview);
  const text = answer
    ? bookingLink && category === 'booking'
      ? `${answer}\n${bookingLink}`
      : answer
    : handoffMessage(language);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      language: language ?? undefined,
      category,
      summary: analysis.summary ?? undefined,
      status: plan.escalate && conversation.status === 'OPEN' ? 'ESCALATED' : undefined,
    },
  });

  await prisma.inboxMessage.deleteMany({ where: { conversationId, isDraft: true, aiGenerated: true } });
  const draftRow = await prisma.inboxMessage.create({
    data: {
      conversationId,
      channel,
      direction: 'OUTBOUND',
      body: text,
      isDraft: true,
      aiGenerated: true,
      category,
      sources: sources.length ? sources : undefined,
      error: plan.reasons.length ? plan.reasons.join(' ').slice(0, 500) : undefined,
    },
  });

  const result = await runAgentAction({
    scope,
    agent: 'CUSTOMER_ENGAGEMENT',
    action: route.action,
    category: route.category,
    kinds: route.kinds,
    risk: route.risk,
    tool: `inbox:${channel.toLowerCase()}`,
    input: `${category} message on ${channel}: ${inbound.body}`,
    sources: sources.length ? sources : undefined,
    payload: { messageId: draftRow.id, conversationId },
    idempotencyKey: `inbox-reply:${messageId}`,
    // Only an auto-send-allowed plan may ever carry an executor, so a held plan cannot be executed even by a mis-set policy.
    execute: plan.autoSendAllowed
      ? async () => {
          const sent = await sendOutbound({ conversationId, body: text, draftId: draftRow.id, aiGenerated: true });
          if (!sent.ok) throw new Error(sent.error);
          return { summary: `Auto-replied on ${channel} (${category})` };
        }
      : undefined,
  });
  await prisma.inboxMessage.update({ where: { id: draftRow.id }, data: { agentActivityId: result.activityId } });

  if (result.status === 'RUNNING') {
    // EXECUTE came back with nothing to run (a held plan): never send, leave the draft for a human.
    await completeActivity(result.activityId, { summary: 'Held as a draft for a human.' });
  }

  await sideEffects({ scope, conversation, inbound: inbound.body, messageId, analysis, category, escalate: plan.escalate, channel });

  const status =
    result.status === 'DONE' ? 'sent' : result.status === 'FAILED' ? 'failed' : result.status === 'BLOCKED' ? 'blocked' : result.status === 'AWAITING_APPROVAL' ? 'queued' : 'drafted';
  return { status, category, escalated: plan.escalate, draftId: draftRow.id, activityId: result.activityId };
}

type Conv = NonNullable<Awaited<ReturnType<typeof prisma.conversation.findUnique>>>;

/** Lead capture and support ticket creation; both are agent actions, so they follow the owner's mode too. */
async function sideEffects(args: {
  scope: AgentScope;
  conversation: Conv;
  inbound: string;
  messageId: string;
  analysis: Analysis;
  category: string;
  escalate: boolean;
  channel: MessageChannelName;
}) {
  const { scope, conversation, analysis, category, channel } = args;
  if (scope.type !== 'PROJECT') return;

  const lead = analysis.lead;
  const email = lead?.email && isEmail(lead.email) ? lead.email.toLowerCase() : channel === 'EMAIL' ? conversation.contactRef : null;
  const phone = lead?.phone ?? (channel === 'SMS' || channel === 'WHATSAPP' ? conversation.contactRef : null);
  const wantsLead = category === 'lead_qualification' || category === 'booking' || Boolean(lead?.email);
  if (wantsLead && !conversation.leadId && (email || phone)) {
    await runAgentAction({
      scope,
      agent: 'CUSTOMER_ENGAGEMENT',
      action: 'messaging.lead.capture',
      category: 'customer_reply',
      tool: 'leads',
      input: `Lead from ${channel} conversation`,
      idempotencyKey: `inbox-lead:${conversation.id}`,
      execute: async () => {
        const saved = await upsertLead(
          scope.projectId,
          { name: lead?.name || conversation.contactName || 'Inbox contact', email, phone, source: `inbox:${channel.toLowerCase()}`, utm: null, notes: analysis.summary ?? '', consent: false },
        );
        await prisma.conversation.update({ where: { id: conversation.id }, data: { leadId: saved.id } });
        return { summary: saved.created ? 'Lead created from conversation' : 'Linked existing lead' };
      },
    }).catch((error) => console.error('[inbox] lead capture failed:', error));
  }

  if (args.escalate) {
    await runAgentAction({
      scope,
      agent: 'CUSTOMER_ENGAGEMENT',
      action: 'messaging.ticket.create',
      category: 'customer_reply',
      tool: 'support-tickets',
      input: `Escalated ${category} on ${channel}`,
      idempotencyKey: `inbox-ticket:${args.messageId}`,
      execute: async () => {
        const ticket = await prisma.projectSupportTicket.create({
          data: {
            projectId: scopeId(scope),
            question: args.inbound.slice(0, 2000),
            contact: conversation.contactRef.slice(0, 200),
            transcript: { conversationId: conversation.id, channel, category },
          },
        });
        await import('@/lib/meetings/ai')
          .then((m) => m.onSupportEscalation({ projectId: scopeId(scope), ticketId: ticket.id, category, contact: conversation.contactRef, summary: args.inbound }))
          .catch((error) => console.error('[meetings] support hook failed:', error));
        return { summary: `Support ticket ${ticket.id} created` };
      },
    }).catch((error) => console.error('[inbox] ticket creation failed:', error));
  }
}

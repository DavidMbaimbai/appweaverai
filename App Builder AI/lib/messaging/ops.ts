import type { AgentScope } from '@/lib/agents/types';

import { discardDraft, sendHumanReply, setConversationStatus, setTakeover } from './service';
import type { TemplateMessage } from './types';

export type InboxOp =
  | { op: 'send'; conversationId: string; body: string; draftId?: string; templateName?: string; templateLanguage?: string }
  | { op: 'discard'; conversationId: string; draftId: string }
  | { op: 'takeover'; conversationId: string; on: boolean }
  | { op: 'escalate'; conversationId: string }
  | { op: 'resolve'; conversationId: string }
  | { op: 'reopen'; conversationId: string };

export type InboxOpResult = { ok: true; message?: string } | { ok: false; error: string };

/** Runs one inbox operation against a scope; callers do their own authorization first. */
export async function runInboxOp(scope: AgentScope, actorId: string, input: InboxOp): Promise<InboxOpResult> {
  const id = typeof input?.conversationId === 'string' ? input.conversationId : '';
  if (!id) return { ok: false, error: 'Missing conversation.' };
  const missing = { ok: false, error: 'Conversation not found.' } as const;

  switch (input.op) {
    case 'send': {
      const body = typeof input.body === 'string' ? input.body.trim().slice(0, 4000) : '';
      const template: TemplateMessage | null = input.templateName
        ? { name: input.templateName.slice(0, 200), language: (input.templateLanguage || 'en').slice(0, 20) }
        : null;
      if (!body && !template) return { ok: false, error: 'Write a message first.' };
      const result = await sendHumanReply(scope, id, { body, draftId: input.draftId, template, actorId });
      return result.ok ? { ok: true, message: 'Sent.' } : { ok: false, error: result.error };
    }
    case 'discard':
      return (await discardDraft(scope, id, input.draftId)) ? { ok: true } : missing;
    case 'takeover':
      return (await setTakeover(scope, id, Boolean(input.on), actorId)) ? { ok: true } : missing;
    case 'escalate':
      return (await setConversationStatus(scope, id, 'ESCALATED')) ? { ok: true } : missing;
    case 'resolve':
      return (await setConversationStatus(scope, id, 'RESOLVED')) ? { ok: true } : missing;
    case 'reopen':
      return (await setConversationStatus(scope, id, 'OPEN')) ? { ok: true } : missing;
    default:
      return { ok: false, error: 'Unknown operation.' };
  }
}

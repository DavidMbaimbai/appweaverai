import type { AgentScope } from '@/lib/agents/types';
import type { ChannelStatusView, InboxMessageView, InboxThread } from '@/components/app/inbox/inbox-view';

import { channelStatuses } from './connections';
import { getConversation, listConversations } from './service';
import { isConversationStatus, isMessageChannel } from './types';

type SearchParams = { status?: string; channel?: string; q?: string; c?: string };

function parseSources(value: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const o = v as { id?: unknown; title?: unknown };
    return typeof o?.id === 'string' && typeof o.title === 'string' ? [{ id: o.id, title: o.title }] : [];
  });
}

/** Loads the serialisable data the inbox pages render; everything is limited to the given scope. */
export async function loadInboxPageData(scope: AgentScope, params: SearchParams) {
  const status = isConversationStatus(params.status) ? params.status : undefined;
  const channel = isMessageChannel(params.channel) ? params.channel : undefined;
  const q = params.q?.trim().slice(0, 100) || undefined;

  const [rows, statuses, convo] = await Promise.all([
    listConversations(scope, { status, channel, q }),
    channelStatuses(scope),
    params.c ? getConversation(scope, params.c) : Promise.resolve(null),
  ]);

  const toThread = (
    c: (typeof rows)[number] | NonNullable<typeof convo>,
    preview: string | null,
  ): InboxThread => ({
    id: c.id,
    channel: c.channel,
    contactName: c.contactName,
    contactRef: c.contactRef,
    status: c.status,
    humanTakeover: c.humanTakeover,
    isReview: c.isReview,
    category: c.category,
    summary: c.summary,
    language: c.language,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    preview,
  });

  const threads = rows.map((c) => toThread(c, c.messages[0]?.body.slice(0, 120) ?? null));
  const selected = convo
    ? {
        thread: toThread(convo, null),
        messages: convo.messages.map(
          (m): InboxMessageView => ({
            id: m.id,
            direction: m.direction,
            body: m.body,
            createdAt: m.createdAt.toISOString(),
            isDraft: m.isDraft,
            aiGenerated: m.aiGenerated,
            deliveryStatus: m.deliveryStatus,
            category: m.category,
            sources: parseSources(m.sources),
            error: m.error,
          }),
        ),
      }
    : null;

  return { threads, selected, statuses: statuses as ChannelStatusView[], filters: { status, channel, q } };
}

import type { AgentScope } from '@/lib/agents/types';

import { resolveScopeForAccount } from './connections';
import { applyStatusUpdates, handleInbound } from './ingest';
import type { InboundMessage, StatusUpdate } from './types';

/** Routes each inbound message to the scope that owns the receiving account; unknown accounts are dropped. */
export async function processInboundBatch(messages: InboundMessage[], statuses: StatusUpdate[] = []) {
  for (const msg of messages) {
    try {
      const scope: AgentScope | null = await resolveScopeForAccount(msg.channel, msg.accountId);
      if (scope) await handleInbound(scope, msg);
    } catch (error) {
      console.error('[inbox] inbound failed:', error instanceof Error ? error.message : error);
    }
  }
  if (statuses.length) {
    await applyStatusUpdates(statuses).catch((error) => console.error('[inbox] status update failed:', error));
  }
}

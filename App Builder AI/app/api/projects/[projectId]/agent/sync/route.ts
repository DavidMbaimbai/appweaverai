import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { getActiveAgentRun } from '@/lib/agent/run-presence';
import { listTypingUsers } from '@/lib/agent/typing-presence';
import { prisma } from '@/lib/prisma';
import type { AgentMessageMetadata } from '@/lib/agent/types';

/**
 * Polled by the editor's agent panel (every few seconds, only while the
 * viewer isn't actively streaming their own request) so multiple people
 * with the same project open see each other's prompts/AI replies land
 * live, and see a "so-and-so is generating…" indicator while someone
 * else's turn is in flight. This is the collaboration layer for an app
 * where the only way to change files is through the shared AI
 * conversation — there's no free-text editor to apply OT/CRDT sync to.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await context.params;
  const project = await getAccessibleProject(projectId, userId, { id: true });

  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get('conversationId');
  const after = url.searchParams.get('after');

  let messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    metadata: AgentMessageMetadata | null;
  }> = [];

  if (conversationId) {
    const afterDate = after ? new Date(after) : null;
    const rows = await prisma.agentMessage.findMany({
      where: {
        conversationId,
        conversation: { projectId },
        ...(afterDate ? { createdAt: { gt: afterDate } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        role: true,
        content: true,
        metadata: true,
        createdAt: true,
      },
    });

    messages = rows.map((row) => ({
      id: row.id,
      role: row.role === 'USER' ? 'user' : 'assistant',
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      metadata: (row.metadata as AgentMessageMetadata | null) ?? null,
    }));
  }

  const activeRun = getActiveAgentRun(projectId);
  const otherUserRun =
    activeRun && activeRun.userId !== userId
      ? { name: activeRun.name, startedAt: activeRun.startedAt }
      : null;

  const typingUsers = listTypingUsers(projectId, userId).map((entry) => ({
    name: entry.name,
  }));

  return Response.json({ messages, activeRun: otherUserRun, typingUsers });
}

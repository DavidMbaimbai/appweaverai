import { prisma } from '@/lib/prisma';
import { getAccessibleProject } from '@/lib/projects/access';
import type { Prisma } from '@/lib/generated/prisma/client';
import type { AgentToolRiskLevel } from '@/lib/generated/prisma/client';

/** How long the agent loop will wait for a human decision before giving up. */
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const APPROVAL_POLL_INTERVAL_MS = 1500;

/** Creates the audit row for a tool call. For DESTRUCTIVE tools this starts PENDING and blocks execution until decided. */
export async function recordToolCall({
  conversationId,
  projectId,
  toolName,
  input,
  riskLevel,
}: {
  conversationId: string;
  projectId: string;
  toolName: string;
  input: Record<string, unknown>;
  riskLevel: AgentToolRiskLevel;
}) {
  return prisma.agentToolCall.create({
    data: {
      conversationId,
      projectId,
      toolName,
      input: input as Prisma.InputJsonValue,
      riskLevel,
      status: riskLevel === 'DESTRUCTIVE' ? 'PENDING' : 'EXECUTED',
    },
    select: { id: true },
  });
}

export async function markToolCallResult(
  toolCallId: string,
  result: { status: 'EXECUTED' | 'FAILED'; result: string },
) {
  await prisma.agentToolCall
    .update({
      where: { id: toolCallId },
      data: { status: result.status, result: result.result },
    })
    .catch(() => undefined);
}

export type ApprovalOutcome =
  | { decision: 'APPROVED' }
  | { decision: 'DENIED' }
  | { decision: 'TIMED_OUT' };

/** Polls the tool call row until a human approves/denies it, or the timeout elapses. */
export async function waitForToolCallDecision(
  toolCallId: string,
): Promise<ApprovalOutcome> {
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const record = await prisma.agentToolCall.findUnique({
      where: { id: toolCallId },
      select: { status: true },
    });

    if (record?.status === 'APPROVED') return { decision: 'APPROVED' };
    if (record?.status === 'DENIED') return { decision: 'DENIED' };

    await new Promise((resolve) =>
      setTimeout(resolve, APPROVAL_POLL_INTERVAL_MS),
    );
  }

  await prisma.agentToolCall
    .update({
      where: { id: toolCallId },
      data: { status: 'DENIED', result: 'Timed out waiting for approval.' },
    })
    .catch(() => undefined);

  return { decision: 'TIMED_OUT' };
}

/** Called from the decision API route once a signed-in user approves/denies a pending tool call. */
export async function decideToolCall({
  toolCallId,
  userId,
  decision,
}: {
  toolCallId: string;
  userId: string;
  decision: 'APPROVED' | 'DENIED';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const toolCall = await prisma.agentToolCall.findUnique({
    where: { id: toolCallId },
    select: { id: true, projectId: true, status: true },
  });

  if (!toolCall) {
    return { ok: false, error: 'Tool call not found.' };
  }
  if (toolCall.status !== 'PENDING') {
    return { ok: false, error: 'This action has already been decided.' };
  }

  const project = await getAccessibleProject(toolCall.projectId, userId, {
    id: true,
  });
  if (!project) {
    return { ok: false, error: 'Project not found.' };
  }

  await prisma.agentToolCall.update({
    where: { id: toolCallId },
    data: { status: decision, decidedById: userId, decidedAt: new Date() },
  });

  return { ok: true };
}

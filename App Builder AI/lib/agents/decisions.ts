import { prisma } from '@/lib/prisma';

import { getAgentExecutor } from './executors';
import { isAgentPaused, isGloballyPaused } from './pause';
import { finish, runAgentAction, type RunAgentActionResult } from './run';
import { getAgentSetting } from './settings';
import type { AgentRole, AgentScope } from './types';

export type DecisionResult = { ok: true; result?: RunAgentActionResult; executed: boolean } | { ok: false; error: string };

function scopeOf(row: { scopeType: string; scopeId: string }): AgentScope {
  return row.scopeType === 'PLATFORM' ? { type: 'PLATFORM' } : { type: 'PROJECT', projectId: row.scopeId };
}

/** Scope guard so a project owner can only act on their own project's activities. */
function inScope(row: { scopeType: string; scopeId: string }, scope?: AgentScope) {
  if (!scope) return true;
  return row.scopeType === scope.type && (scope.type === 'PLATFORM' || row.scopeId === scope.projectId);
}

/**
 * Explicit per-action approval. The only way a high-risk action runs. Still refuses when the
 * kill switch is on or the agent is disabled/paused. Pass `scope` to restrict to one project.
 */
export async function approveActivity(id: string, actorId: string, scope?: AgentScope): Promise<DecisionResult> {
  const row = await prisma.agentActivity.findUnique({ where: { id } });
  if (!row || !inScope(row, scope)) return { ok: false, error: 'Activity not found.' };
  if (row.status !== 'AWAITING_APPROVAL' && row.status !== 'PLANNED') return { ok: false, error: 'This activity is not waiting for approval.' };

  const rowScope = scopeOf(row);
  const agent = row.agent as AgentRole;
  const setting = await getAgentSetting(rowScope, agent);
  const paused = (await isGloballyPaused()) || (rowScope.type === 'PLATFORM' && (await isAgentPaused()));
  if (paused || setting.paused || !setting.enabled) {
    return { ok: false, error: 'The agent is paused or disabled. Resume it before approving.' };
  }

  const claimed = await prisma.agentActivity.updateMany({
    where: { id, status: row.status },
    data: { status: 'RUNNING', decidedBy: actorId, decidedAt: new Date(), decisionReason: 'Approved by a human.' },
  });
  if (claimed.count === 0) return { ok: false, error: 'Already handled.' };

  const executor = getAgentExecutor(row.action);
  if (!executor) {
    // Approved, but no executor is registered here: the owning feature picks it up from the PLANNED + decidedBy queue.
    await prisma.agentActivity.update({ where: { id }, data: { status: 'PLANNED' } });
    return { ok: true, executed: false };
  }
  const result = await finish(id, rowScope, agent, row.action, row.category, row.payload, executor, 'EXECUTE', 'Approved by a human.');
  return { ok: true, executed: true, result };
}

export async function rejectActivity(id: string, actorId: string, scope?: AgentScope): Promise<DecisionResult> {
  return stop(id, actorId, scope, 'Rejected', ['AWAITING_APPROVAL', 'PLANNED']);
}

/** Pauses one queued activity so it will not run until retried. */
export async function pauseActivity(id: string, actorId: string, scope?: AgentScope): Promise<DecisionResult> {
  return stop(id, actorId, scope, 'Paused', ['AWAITING_APPROVAL', 'PLANNED', 'RUNNING']);
}

async function stop(id: string, actorId: string, scope: AgentScope | undefined, label: string, from: string[]): Promise<DecisionResult> {
  const row = await prisma.agentActivity.findUnique({ where: { id } });
  if (!row || !inScope(row, scope)) return { ok: false, error: 'Activity not found.' };
  const claimed = await prisma.agentActivity.updateMany({
    where: { id, status: { in: from as never[] } },
    data: { status: 'BLOCKED', decidedBy: actorId, decidedAt: new Date(), error: `${label} by a human.` },
  });
  return claimed.count === 0 ? { ok: false, error: 'This activity can no longer be changed.' } : { ok: true, executed: false };
}

/** Re-runs a FAILED or BLOCKED activity as a new linked activity (policy is checked again). */
export async function retryActivity(id: string, scope?: AgentScope): Promise<DecisionResult> {
  const row = await prisma.agentActivity.findUnique({ where: { id } });
  if (!row || !inScope(row, scope)) return { ok: false, error: 'Activity not found.' };
  if (row.status !== 'FAILED' && row.status !== 'BLOCKED') return { ok: false, error: 'Only failed or blocked activities can be retried.' };
  const result = await runAgentAction({
    scope: scopeOf(row),
    agent: row.agent as AgentRole,
    action: row.action,
    category: row.category,
    risk: row.risk as 'LOW' | 'MEDIUM' | 'HIGH',
    tool: row.tool ?? undefined,
    sources: row.sources ?? undefined,
    input: row.inputSummary ?? undefined,
    payload: row.payload ?? undefined,
    retryOf: row.id,
  });
  return { ok: true, executed: result.status === 'DONE', result };
}

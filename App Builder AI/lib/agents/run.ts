import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { getAgentExecutor, type AgentExecutor } from './executors';
import { isGloballyPaused, isAgentPaused } from './pause';
import { classifyRisk, decide, type PolicyOutcome } from './policy';
import { getAgentSetting, usageToday } from './settings';
import { redactSensitive } from './untrusted';
import { scopeId, type ActivityStatus, type AgentRisk, type AgentRole, type AgentScope } from './types';

/** Optional credits integration: return credits charged (or null). Errors are swallowed. */
export type CreditsHook = (activity: { id: string; scope: AgentScope; agent: AgentRole; action: string; costCents: number }) => Promise<number | null>;

export type RunAgentActionInput = {
  scope: AgentScope;
  agent: AgentRole;
  /** Stable action name, e.g. "social.reply.send"; also the executor registry key. */
  action: string;
  /** Policy category, e.g. "social_post"; matched against the owner's autonomous categories. */
  category: string;
  /** High-risk kinds involved (see HIGH_RISK_KINDS); any of them forces per-action approval. */
  kinds?: string[];
  risk?: AgentRisk;
  tool?: string;
  sources?: unknown;
  /** Human-readable input; it is redacted and truncated before storage. */
  input?: string;
  /** Non-secret data an executor needs after approval. */
  payload?: unknown;
  estimatedCostCents?: number;
  idempotencyKey?: string;
  retryOf?: string;
  /** Runs now only if policy says EXECUTE; otherwise the registered executor runs after approval. */
  execute?: AgentExecutor;
  credits?: CreditsHook;
};

export type RunAgentActionResult = {
  activityId: string;
  outcome: PolicyOutcome;
  status: ActivityStatus;
  reason: string;
  duplicate?: boolean;
  resultSummary?: string | null;
  error?: string | null;
};

const json = (value: unknown) => (value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue));

const STATUS_FOR: Record<PolicyOutcome, ActivityStatus> = {
  EXECUTE: 'RUNNING',
  NEEDS_APPROVAL: 'AWAITING_APPROVAL',
  DRAFT_ONLY: 'PLANNED',
  BLOCKED: 'BLOCKED',
};

/**
 * Single entry point for any agent action: checks settings, kill switches and daily caps,
 * records an AgentActivity before and after, and either runs, queues for approval, drafts or blocks.
 */
export async function runAgentAction(input: RunAgentActionInput): Promise<RunAgentActionResult> {
  if (input.idempotencyKey) {
    const existing = await prisma.agentActivity.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return toResult(existing, existing.status as ActivityStatus, existing.decisionReason ?? '', true);
  }

  const [setting, globalPause, platformPause, usage] = await Promise.all([
    getAgentSetting(input.scope, input.agent),
    isGloballyPaused(),
    input.scope.type === 'PLATFORM' ? isAgentPaused() : Promise.resolve(false),
    usageToday(input.scope, input.agent),
  ]);
  const risk = classifyRisk(input.kinds, input.risk ?? 'LOW');
  const cost = input.estimatedCostCents ?? 0;
  const withinLimits =
    usage.count < setting.dailyActionLimit && (cost === 0 || usage.costCents + cost <= setting.dailyBudgetCents);
  const decision = decide({
    mode: setting.mode,
    enabled: setting.enabled,
    paused: setting.paused,
    category: input.category,
    actionRisk: risk,
    withinLimits,
    globalPause: globalPause || platformPause,
    autonomousCategories: setting.categories,
    scope: input.scope.type,
  });

  let activity;
  try {
    activity = await prisma.agentActivity.create({
      data: {
        scopeType: input.scope.type,
        scopeId: scopeId(input.scope),
        agent: input.agent,
        action: input.action,
        category: input.category,
        risk,
        status: STATUS_FOR[decision.outcome],
        sources: json(input.sources),
        tool: input.tool,
        inputSummary: input.input ? redactSensitive(input.input).slice(0, 1000) : undefined,
        payload: json(input.payload),
        decisionReason: decision.reason,
        retryOf: input.retryOf,
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (error) {
    if (input.idempotencyKey && (error as { code?: string }).code === 'P2002') {
      const existing = await prisma.agentActivity.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return toResult(existing, existing.status as ActivityStatus, existing.decisionReason ?? '', true);
    }
    throw error;
  }

  if (decision.outcome !== 'EXECUTE') {
    return toResult(activity, STATUS_FOR[decision.outcome], decision.reason, false, decision.outcome);
  }
  const run = input.execute ?? getAgentExecutor(input.action);
  if (!run) return toResult(activity, 'RUNNING', decision.reason, false, 'EXECUTE');
  return finish(activity.id, input.scope, input.agent, input.action, activity.category, activity.payload, run, 'EXECUTE', decision.reason, input.credits);
}

function toResult(
  row: { id: string; status: string; resultSummary: string | null; error: string | null },
  status: ActivityStatus,
  reason: string,
  duplicate: boolean,
  outcome?: PolicyOutcome,
): RunAgentActionResult {
  return {
    activityId: row.id,
    outcome: outcome ?? (status === 'BLOCKED' ? 'BLOCKED' : status === 'AWAITING_APPROVAL' ? 'NEEDS_APPROVAL' : status === 'PLANNED' ? 'DRAFT_ONLY' : 'EXECUTE'),
    status,
    reason,
    duplicate: duplicate || undefined,
    resultSummary: row.resultSummary,
    error: row.error,
  };
}

/** Runs the executor for an activity already marked RUNNING and records DONE or FAILED. */
export async function finish(
  id: string,
  scope: AgentScope,
  agent: AgentRole,
  action: string,
  category: string,
  payload: unknown,
  run: AgentExecutor,
  outcome: PolicyOutcome,
  reason: string,
  credits?: CreditsHook,
): Promise<RunAgentActionResult> {
  try {
    const result = await run({ activityId: id, scope, agent, action, category, payload });
    const costCents = Math.max(0, Math.round(result.costCents ?? 0));
    const done = await prisma.agentActivity.update({
      where: { id },
      data: { status: 'DONE', resultSummary: redactSensitive(result.summary).slice(0, 1000), costCents, error: null },
    });
    if (credits) {
      const charged = await credits({ id, scope, agent, action, costCents }).catch(() => null);
      if (charged !== null) await prisma.agentActivity.update({ where: { id }, data: { creditsCharged: charged } });
    }
    return toResult(done, 'DONE', reason, false, outcome);
  } catch (error) {
    const message = redactSensitive(error instanceof Error ? error.message : String(error)).slice(0, 500);
    const failed = await prisma.agentActivity.update({ where: { id }, data: { status: 'FAILED', error: message } });
    return toResult(failed, 'FAILED', reason, false, outcome);
  }
}

/** For callers that run the action themselves after an EXECUTE outcome with no executor. */
export async function completeActivity(id: string, result: { summary?: string; costCents?: number; error?: string }) {
  await prisma.agentActivity.update({
    where: { id },
    data: result.error
      ? { status: 'FAILED', error: redactSensitive(result.error).slice(0, 500) }
      : { status: 'DONE', resultSummary: redactSensitive(result.summary ?? '').slice(0, 1000), costCents: result.costCents ?? 0 },
  });
}

import type { AgentRole, AgentScope } from './types';

export type ExecutorContext = {
  activityId: string;
  scope: AgentScope;
  agent: AgentRole;
  action: string;
  category: string;
  payload: unknown;
};

export type ExecutorResult = { summary: string; costCents?: number };
export type AgentExecutor = (ctx: ExecutorContext) => Promise<ExecutorResult>;

const executors = new Map<string, AgentExecutor>();

/**
 * Registers what to run for an action name when an owner approves or retries it later
 * (possibly in another request). Register at module load of the feature that owns the action.
 */
export function registerAgentExecutor(action: string, executor: AgentExecutor) {
  executors.set(action, executor);
}

export function getAgentExecutor(action: string): AgentExecutor | undefined {
  return executors.get(action);
}

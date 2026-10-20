import { buildUntrustedCall } from '@/lib/agents/untrusted';

import { validatePlan, type PlanResult } from './dag';
import { extractJsonObject } from './parse';
import { approxTokens } from './prompts';
import { DEV_TEAM_ROLE_LABELS, DEV_TEAM_ROLES, type DevTeamLimits } from './types';

const PLANNER_SYSTEM = [
  'You are the Architect of an AI development team. You never edit files; you turn the goal into a small task graph for specialist roles.',
  'Roles and what they do:',
  ...DEV_TEAM_ROLES.map((r) => `- ${r}: ${DEV_TEAM_ROLE_LABELS[r].description}`),
  'You cannot and must not plan anything that publishes, deploys, sends messages or spends money.',
].join('\n');

export function buildPlannerCall(args: { goal: string; brief: string; filePaths: string[]; limits: Pick<DevTeamLimits, 'maxTasks' | 'maxDepth' | 'maxDependenciesPerTask'> }) {
  const task = [
    `Goal: ${args.goal}`,
    `Plan at most ${args.limits.maxTasks} tasks; the longest dependency chain may be ${args.limits.maxDepth}; at most ${args.limits.maxDependenciesPerTask} dependencies per task.`,
    'Give each task a key t1, t2, ... and list the keys it depends on (a task runs only after its dependencies finish and receives their output).',
    'Independent work should NOT depend on each other so it can run in parallel. Put TESTING and SECURITY review tasks after the implementation tasks they review.',
    'Reply with ONE JSON object and nothing else:',
    '{"summary": "<one paragraph plan>", "tasks": [{"key": "t1", "role": "FRONTEND", "title": "...", "description": "...", "dependsOn": [], "files": ["<paths to read, optional>"]}]}',
  ].join('\n');
  const untrusted = [
    ...(args.brief ? [{ label: 'projectbrief', content: args.brief, redact: true, maxLength: 4000 }] : []),
    { label: 'filelist', content: args.filePaths.slice(0, 200).join('\n') || '(no files yet)', maxLength: 6000 },
  ];
  const call = buildUntrustedCall({ system: PLANNER_SYSTEM, task, untrusted });
  return { ...call, tokenEstimate: approxTokens(call.system) + approxTokens(call.messages[0].content) };
}

export type ParsedPlan = { ok: true; summary: string; tasks: Extract<PlanResult, { ok: true }>['tasks']; depth: number } | { ok: false; errors: string[] };

export function parsePlan(text: string, limits: Pick<DevTeamLimits, 'maxTasks' | 'maxDepth' | 'maxDependenciesPerTask'>): ParsedPlan {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['The architect did not return a JSON plan.'] };
  const record = raw as Record<string, unknown>;
  const result = validatePlan(record.tasks, limits);
  if (!result.ok) return result;
  const summary = typeof record.summary === 'string' ? record.summary.replace(/\s+/g, ' ').trim().slice(0, 1000) : '';
  return { ok: true, summary, tasks: result.tasks, depth: result.depth };
}

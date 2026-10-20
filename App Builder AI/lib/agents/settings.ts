import { prisma } from '@/lib/prisma';

import {
  AGENT_ROLES,
  isAgentMode,
  isAgentRole,
  scopeId,
  type AgentModeName,
  type AgentRole,
  type AgentScope,
} from './types';

export type AgentSettingView = {
  agent: AgentRole;
  mode: AgentModeName;
  enabled: boolean;
  paused: boolean;
  categories: string[];
  dailyActionLimit: number;
  dailyBudgetCents: number;
  authorisedBy: string | null;
  authorisedAt: Date | null;
};

export type AgentSettingInput = {
  mode?: AgentModeName;
  enabled?: boolean;
  categories?: string[];
  dailyActionLimit?: number;
  dailyBudgetCents?: number;
  /** The explicit authorisation checkbox; required the first time AUTONOMOUS is chosen. */
  authorise?: boolean;
};

const DEFAULTS = { mode: 'ASSIST', enabled: false, paused: false, categories: [], dailyActionLimit: 20, dailyBudgetCents: 0 } as const;

function key(scope: AgentScope, agent: AgentRole) {
  return { scopeType_scopeId_agent: { scopeType: scope.type, scopeId: scopeId(scope), agent } };
}

type Row = {
  agent: AgentRole;
  mode: AgentModeName;
  enabled: boolean;
  paused: boolean;
  categories: unknown;
  dailyActionLimit: number;
  dailyBudgetCents: number;
  authorisedBy: string | null;
  authorisedAt: Date | null;
};

function toView(agent: AgentRole, row: Row | null): AgentSettingView {
  return {
    agent,
    mode: row?.mode ?? DEFAULTS.mode,
    enabled: row?.enabled ?? DEFAULTS.enabled,
    paused: row?.paused ?? DEFAULTS.paused,
    categories: Array.isArray(row?.categories) ? (row.categories as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    dailyActionLimit: row?.dailyActionLimit ?? DEFAULTS.dailyActionLimit,
    dailyBudgetCents: row?.dailyBudgetCents ?? DEFAULTS.dailyBudgetCents,
    authorisedBy: row?.authorisedBy ?? null,
    authorisedAt: row?.authorisedAt ?? null,
  };
}

export async function getAgentSetting(scope: AgentScope, agent: AgentRole): Promise<AgentSettingView> {
  return toView(agent, await prisma.agentSetting.findUnique({ where: key(scope, agent) }));
}

/** Settings for all seven agents in a scope, with safe defaults (disabled, ASSIST) when unset. */
export async function listAgentSettings(scope: AgentScope): Promise<AgentSettingView[]> {
  const rows = await prisma.agentSetting.findMany({ where: { scopeType: scope.type, scopeId: scopeId(scope) } });
  return AGENT_ROLES.map((agent) => toView(agent, rows.find((row) => row.agent === agent) ?? null));
}

/**
 * Validates and saves settings. Caller must already have authorised the actor for this scope
 * (project owner or admin). Choosing AUTONOMOUS requires `authorise: true` once, which stores who/when.
 */
export async function saveAgentSetting(
  scope: AgentScope,
  agent: unknown,
  input: AgentSettingInput,
  actorId: string,
): Promise<{ ok: true; setting: AgentSettingView } | { ok: false; error: string }> {
  if (!isAgentRole(agent)) return { ok: false, error: 'Unknown agent.' };
  if (input.mode !== undefined && !isAgentMode(input.mode)) return { ok: false, error: 'Unknown mode.' };
  const limit = input.dailyActionLimit;
  const budget = input.dailyBudgetCents;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 10_000)) {
    return { ok: false, error: 'Daily action limit must be a whole number between 0 and 10000.' };
  }
  if (budget !== undefined && (!Number.isInteger(budget) || budget < 0 || budget > 10_000_000)) {
    return { ok: false, error: 'Daily budget must be a whole, non-negative amount.' };
  }

  const existing = await prisma.agentSetting.findUnique({ where: key(scope, agent) });
  const mode = input.mode ?? existing?.mode ?? 'ASSIST';
  let authorisedBy = existing?.authorisedBy ?? null;
  let authorisedAt = existing?.authorisedAt ?? null;
  if (mode === 'AUTONOMOUS') {
    if (!authorisedAt) {
      if (!input.authorise) return { ok: false, error: 'Autonomous mode needs your explicit authorisation.' };
      authorisedBy = actorId;
      authorisedAt = new Date();
    }
  } else {
    authorisedBy = null;
    authorisedAt = null;
  }

  const data = {
    mode,
    enabled: input.enabled ?? existing?.enabled ?? false,
    categories: (input.categories ?? (existing ? toView(agent, existing).categories : [])).slice(0, 30),
    dailyActionLimit: limit ?? existing?.dailyActionLimit ?? DEFAULTS.dailyActionLimit,
    dailyBudgetCents: budget ?? existing?.dailyBudgetCents ?? DEFAULTS.dailyBudgetCents,
    authorisedBy,
    authorisedAt,
  };
  const row = await prisma.agentSetting.upsert({
    where: key(scope, agent),
    create: { scopeType: scope.type, scopeId: scopeId(scope), agent, ...data },
    update: data,
  });
  return { ok: true, setting: toView(agent, row) };
}

/** Instantly pauses/resumes (or disables) one agent without touching its other settings. */
export async function setAgentPaused(scope: AgentScope, agent: AgentRole, paused: boolean, disable = false) {
  const update = { paused, ...(disable ? { enabled: false } : {}) };
  await prisma.agentSetting.upsert({
    where: key(scope, agent),
    create: { scopeType: scope.type, scopeId: scopeId(scope), agent, ...update },
    update,
  });
}

export async function usageToday(scope: AgentScope, agent: AgentRole, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const where = {
    scopeType: scope.type,
    scopeId: scopeId(scope),
    agent,
    createdAt: { gte: start },
    status: { not: 'BLOCKED' as const },
  };
  const [count, sum] = await Promise.all([
    prisma.agentActivity.count({ where }),
    prisma.agentActivity.aggregate({ where, _sum: { costCents: true } }),
  ]);
  return { count, costCents: sum._sum.costCents ?? 0 };
}

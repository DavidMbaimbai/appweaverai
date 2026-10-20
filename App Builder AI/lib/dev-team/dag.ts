import { DEV_TEAM_DEFAULTS, isDevTeamRole, type DevTeamLimits, type DevTeamRoleName } from './types';

/** Effective limits: placeholders from DEV_TEAM_DEFAULTS, optionally overridden by the DEV_TEAM_LIMITS env var (JSON). */
export function resolveLimits(env: NodeJS.ProcessEnv = process.env): DevTeamLimits {
  const limits: DevTeamLimits = { ...DEV_TEAM_DEFAULTS };
  const raw = env.DEV_TEAM_LIMITS?.trim();
  if (!raw) return limits;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return limits;
    for (const [key, value] of Object.entries(parsed)) {
      if (key in limits && typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        limits[key as keyof DevTeamLimits] = value;
      }
    }
  } catch {
    // A malformed override must never loosen limits.
  }
  // Safety rails: overrides cannot make these unbounded or zero.
  limits.maxTasks = Math.min(Math.max(1, limits.maxTasks), 20);
  limits.concurrency = Math.min(Math.max(1, limits.concurrency), 6);
  limits.maxAttemptsPerTask = Math.min(Math.max(1, limits.maxAttemptsPerTask), 3);
  limits.maxModelCalls = Math.min(Math.max(1, limits.maxModelCalls), 60);
  return limits;
}

export type PlanTask = {
  key: string;
  role: DevTeamRoleName;
  title: string;
  description: string;
  dependsOn: string[];
  /** Project files the task should read (hints, validated again before reading). */
  files: string[];
};

export type PlanResult = { ok: true; tasks: PlanTask[]; depth: number } | { ok: false; errors: string[] };

const KEY = /^t[1-9]\d?$/;

function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Longest dependency chain length (1 = no dependencies). Assumes the graph is acyclic. */
export function graphDepth(tasks: Array<{ key: string; dependsOn: string[] }>): number {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const memo = new Map<string, number>();
  const visit = (key: string, seen: Set<string>): number => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (seen.has(key)) return Infinity;
    seen.add(key);
    const task = byKey.get(key);
    const depth = 1 + Math.max(0, ...(task?.dependsOn ?? []).map((d) => visit(d, seen)));
    seen.delete(key);
    memo.set(key, depth);
    return depth;
  };
  return Math.max(0, ...tasks.map((t) => visit(t.key, new Set())));
}

/** Kahn's algorithm: the keys that sit on or behind a cycle (empty when the graph is a DAG). */
export function findCycle(tasks: Array<{ key: string; dependsOn: string[] }>): string[] {
  const indegree = new Map(tasks.map((t) => [t.key, t.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) for (const dep of task.dependsOn) dependents.set(dep, [...(dependents.get(dep) ?? []), task.key]);
  const queue = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.key);
  let visited = 0;
  while (queue.length > 0) {
    const key = queue.shift() as string;
    visited += 1;
    for (const next of dependents.get(key) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return visited === tasks.length ? [] : tasks.filter((t) => (indegree.get(t.key) ?? 0) > 0).map((t) => t.key);
}

/** Validates the architect's plan: bounded size, known roles, known dependencies, no cycles, bounded depth. */
export function validatePlan(raw: unknown, limits: Pick<DevTeamLimits, 'maxTasks' | 'maxDepth' | 'maxDependenciesPerTask'> = DEV_TEAM_DEFAULTS): PlanResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ['The plan must be a list of tasks.'] };
  if (raw.length === 0) return { ok: false, errors: ['The plan has no tasks.'] };
  if (raw.length > limits.maxTasks) return { ok: false, errors: [`The plan has ${raw.length} tasks; the limit is ${limits.maxTasks}.`] };

  const tasks: PlanTask[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const label = `Task ${index + 1}`;
    if (!item || typeof item !== 'object') {
      errors.push(`${label} is not an object.`);
      return;
    }
    const record = item as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    if (!KEY.test(key)) errors.push(`${label} has an invalid key (use t1, t2, ...).`);
    else if (seen.has(key)) errors.push(`Duplicate task key ${key}.`);
    seen.add(key);
    if (!isDevTeamRole(record.role)) errors.push(`${label} has an unknown role.`);
    const title = cleanText(record.title, 120);
    if (!title) errors.push(`${label} has no title.`);
    const dependsOn = Array.isArray(record.dependsOn) ? record.dependsOn.filter((d): d is string => typeof d === 'string').map((d) => d.trim()) : [];
    if (record.dependsOn !== undefined && !Array.isArray(record.dependsOn)) errors.push(`${label} dependsOn must be a list.`);
    if (new Set(dependsOn).size !== dependsOn.length) errors.push(`${label} lists a dependency twice.`);
    if (dependsOn.length > limits.maxDependenciesPerTask) errors.push(`${label} has too many dependencies.`);
    const files = Array.isArray(record.files) ? record.files.filter((f): f is string => typeof f === 'string').slice(0, 5) : [];
    tasks.push({
      key,
      role: record.role as DevTeamRoleName,
      title,
      description: cleanText(record.description, 800),
      dependsOn,
      files,
    });
  });
  if (errors.length > 0) return { ok: false, errors };

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.key) errors.push(`${task.key} depends on itself.`);
      else if (!seen.has(dep)) errors.push(`${task.key} depends on unknown task ${dep}.`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const cycle = findCycle(tasks);
  if (cycle.length > 0) return { ok: false, errors: [`The plan has a dependency cycle involving ${cycle.join(', ')}.`] };

  const depth = graphDepth(tasks);
  if (depth > limits.maxDepth) return { ok: false, errors: [`The longest dependency chain is ${depth}; the limit is ${limits.maxDepth}.`] };
  return { ok: true, tasks, depth };
}

/** All dependencies of a task, transitively (used to give a task the context of everything upstream). */
export function transitiveDependencies(tasks: Array<{ key: string; dependsOn: string[] }>, key: string): string[] {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const out = new Set<string>();
  const stack = [...(byKey.get(key)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(byKey.get(next)?.dependsOn ?? []));
  }
  return [...out];
}

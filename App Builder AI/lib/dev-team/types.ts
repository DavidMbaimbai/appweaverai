/** Client-safe constants for the AI development team (no server imports). */

export const DEV_TEAM_ROLES = ['ARCHITECT', 'FRONTEND', 'BACKEND', 'DATABASE', 'TESTING', 'SECURITY', 'DEVOPS'] as const;
export type DevTeamRoleName = (typeof DEV_TEAM_ROLES)[number];

export const DEV_TEAM_ROLE_LABELS: Record<DevTeamRoleName, { label: string; description: string }> = {
  ARCHITECT: { label: 'Architect', description: 'Plans the work as a task graph and resolves hard conflicts. Never edits files.' },
  FRONTEND: { label: 'Frontend', description: 'Pages, components, styles and client assets.' },
  BACKEND: { label: 'Backend', description: 'Server code, API routes and business logic.' },
  DATABASE: { label: 'Database', description: 'Schema, migrations and queries.' },
  TESTING: { label: 'Testing', description: 'Read-only reviewer: finds gaps and risks, writes findings, changes nothing.' },
  SECURITY: { label: 'Security', description: 'Read-only reviewer: finds vulnerabilities and unsafe patterns, changes nothing.' },
  DEVOPS: { label: 'DevOps', description: 'Build, config and deployment files.' },
};

export const DEV_TEAM_RUN_STATUSES = [
  'PLANNING',
  'RUNNING',
  'NEEDS_DECISION',
  'AWAITING_APPROVAL',
  'APPLIED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
] as const;
export type DevTeamRunStatusName = (typeof DEV_TEAM_RUN_STATUSES)[number];

export const ACTIVE_RUN_STATUSES: readonly DevTeamRunStatusName[] = ['PLANNING', 'RUNNING'];

export const DEV_TEAM_STATUS_LABELS: Record<DevTeamRunStatusName, string> = {
  PLANNING: 'Planning',
  RUNNING: 'Working',
  NEEDS_DECISION: 'Needs your decision',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPLIED: 'Applied',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/**
 * Limits and prices. Every number here is a PLACEHOLDER to be tuned against real cost data; they can be
 * overridden with the DEV_TEAM_LIMITS env var (JSON) without a deploy.
 */
export const DEV_TEAM_DEFAULTS = {
  /** Largest task graph the architect may produce. */
  maxTasks: 8,
  /** Longest dependency chain. */
  maxDepth: 5,
  maxDependenciesPerTask: 4,
  /** Tasks executed in parallel. */
  concurrency: 3,
  /** A single task (model call) is abandoned after this long. */
  taskTimeoutMs: 90_000,
  /** The whole run stops starting new tasks after this long. */
  runTimeoutMs: 270_000,
  maxAttemptsPerTask: 2,
  /** Hard cap on model calls per run (planner + tasks + retries + resolver). */
  maxModelCalls: 16,
  /** Approximate input budget for one task prompt, in tokens (chars / 4). */
  contextTokenBudget: 12_000,
  /** Approximate budget for each dependency output inside a task prompt. */
  dependencyTokenBudget: 1_200,
  maxFilesPerProposal: 6,
  maxFilesPerRun: 20,
  maxFileBytes: 120_000,
  /** Credits (placeholder prices). */
  plannerCredits: 3,
  taskCredits: 4,
  resolverCredits: 3,
  /** Never reserve or spend more than this for one run, whatever the plan says. */
  runCreditCap: 40,
  /** Runs started per user per hour. */
  runsPerHour: 6,
} as const;

export type DevTeamLimits = { -readonly [K in keyof typeof DEV_TEAM_DEFAULTS]: number };

export function isDevTeamRole(value: unknown): value is DevTeamRoleName {
  return typeof value === 'string' && (DEV_TEAM_ROLES as readonly string[]).includes(value);
}

export const MAX_GOAL_CHARS = 2000;
export const MIN_GOAL_CHARS = 10;

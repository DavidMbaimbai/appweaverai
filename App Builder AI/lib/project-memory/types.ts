export const MEMORY_TYPES = [
  'ARCHITECTURE',
  'DECISION',
  'BUSINESS_RULE',
  'CONVENTION',
  'KNOWN_BUG',
  'FIXED_BUG',
  'FEATURE_STATUS',
  'INTEGRATION',
  'DESIGN',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SOURCES = ['AGENT', 'USER', 'SYSTEM'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REJECTED'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const FEATURE_STATES = ['COMPLETED', 'PROTECTED'] as const;
export type FeatureState = (typeof FEATURE_STATES)[number];

export const TYPE_LABELS: Record<MemoryType, string> = {
  ARCHITECTURE: 'Architecture',
  DECISION: 'Decision',
  BUSINESS_RULE: 'Business rule',
  CONVENTION: 'Convention',
  KNOWN_BUG: 'Known bug',
  FIXED_BUG: 'Fixed bug',
  FEATURE_STATUS: 'Feature status',
  INTEGRATION: 'Integration',
  DESIGN: 'Design',
};

export type MemoryEvidence = {
  files?: string[];
  checkpointId?: string;
  messageId?: string;
};

/** Plain shape used by ranking, the brief and reconciliation, independent of Prisma. */
export type MemoryRecord = {
  id: string;
  type: MemoryType;
  title: string;
  normalizedTitle: string;
  body: string;
  source: MemorySource;
  confidence: number;
  status: MemoryStatus;
  pinned: boolean;
  featureState: FeatureState | null;
  files: string[];
  evidence?: MemoryEvidence | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CodeMapRecord = {
  path: string;
  purpose: string;
  exports: string[];
  routes: string[];
  dependencies: string[];
};

export const LIMITS = {
  titleMax: 120,
  bodyMax: 1200,
  filesMax: 20,
  /** Active entries kept per project before the agent stops adding new ones. */
  maxActivePerProject: 400,
  maxNewPerRun: 5,
  /** Files whose purpose may be written by the model in one post-run call. */
  maxLlmFilesPerRun: 6,
  maxCodeMapFiles: 400,
  maxCodeMapFileBytes: 200_000,
  injectionHistory: 20,
} as const;

export function defaultBriefBudgetTokens() {
  const raw = Number.parseInt(process.env.PROJECT_BRIEF_TOKEN_BUDGET ?? '', 10);
  return Number.isFinite(raw) && raw >= 200 && raw <= 8000 ? raw : 1500;
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

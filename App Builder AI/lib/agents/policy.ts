import {
  HIGH_RISK_KINDS,
  type AgentModeName,
  type AgentRisk,
  type AgentScope,
} from './types';

export type PolicyOutcome = 'EXECUTE' | 'NEEDS_APPROVAL' | 'DRAFT_ONLY' | 'BLOCKED';

export type PolicyInput = {
  mode: AgentModeName;
  enabled: boolean;
  paused: boolean;
  category: string;
  actionRisk: AgentRisk;
  withinLimits: boolean;
  globalPause: boolean;
  /** Categories the owner allowed to run autonomously. */
  autonomousCategories?: readonly string[] | null;
  scope?: AgentScope['type'];
};

export type PolicyDecision = { outcome: PolicyOutcome; reason: string };

/** Review replies are drafted for a human on the platform scope, never sent automatically. */
export const NEVER_AUTO_CATEGORIES_PLATFORM: readonly string[] = ['review_reply'];

/** Returns HIGH if any of the action kinds is a high-risk kind, otherwise the fallback risk. */
export function classifyRisk(kinds: readonly string[] = [], fallback: AgentRisk = 'LOW'): AgentRisk {
  return kinds.some((kind) => (HIGH_RISK_KINDS as readonly string[]).includes(kind)) ? 'HIGH' : fallback;
}

/**
 * Pure policy gate. EXECUTE is only returned for non-high-risk actions in AUTONOMOUS
 * mode whose category the owner allowed; high-risk actions never execute without
 * explicit per-action approval (given through approveActivity).
 */
export function decide(input: PolicyInput): PolicyDecision {
  if (input.globalPause) return { outcome: 'BLOCKED', reason: 'Global kill switch is on.' };
  if (!input.enabled) return { outcome: 'BLOCKED', reason: 'This agent is disabled.' };
  if (input.paused) return { outcome: 'BLOCKED', reason: 'This agent is paused.' };
  if (!input.withinLimits) return { outcome: 'BLOCKED', reason: 'Daily action or budget limit reached.' };

  if (input.scope === 'PLATFORM' && NEVER_AUTO_CATEGORIES_PLATFORM.includes(input.category)) {
    return { outcome: 'DRAFT_ONLY', reason: 'Review replies are never sent automatically on the platform.' };
  }

  if (input.actionRisk === 'HIGH') {
    return input.mode === 'ASSIST'
      ? { outcome: 'DRAFT_ONLY', reason: 'High-risk action: Assist mode only drafts.' }
      : { outcome: 'NEEDS_APPROVAL', reason: 'High-risk action: explicit approval is required every time.' };
  }

  if (input.mode === 'ASSIST') return { outcome: 'DRAFT_ONLY', reason: 'Assist mode only drafts.' };
  if (input.mode === 'APPROVAL') return { outcome: 'NEEDS_APPROVAL', reason: 'Approval mode: waiting for a human.' };

  if (input.autonomousCategories?.includes(input.category)) {
    return { outcome: 'EXECUTE', reason: 'Autonomous category within limits.' };
  }
  return { outcome: 'NEEDS_APPROVAL', reason: 'Category is not allowed to run autonomously.' };
}

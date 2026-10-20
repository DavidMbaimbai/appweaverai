import {
  ANTHROPIC_MAX_TOKENS,
  MAX_AGENT_TURNS,
  getAnthropicModel,
} from '@/lib/agent/constants';

import { PublishVisibility } from '../publish/visibility';
import { PLAN_DEFINITIONS, resolvePlanId } from './plans';

export type AppTier = 'guest' | 'free' | 'pro';

export type UserBillingFields = {
  subscriptionPlan: string;
  subscriptionStatus: string | null;
};

export type AgentLimits = {
  maxTurns: number;
  maxTokens: number;
  model: string;
};

export const FREE_PROJECT_LIMIT = PLAN_DEFINITIONS.free.limits.projects ?? 3;
export const FREE_PRIVATE_DEPLOYMENT_LIMIT = 1;

const FREE_AGENT_LIMITS: AgentLimits = {
  maxTurns: 12,
  maxTokens: 8_192,
  model: 'claude-sonnet-4-6',
};

const PRO_AGENT_LIMITS: AgentLimits = {
  maxTurns: MAX_AGENT_TURNS,
  maxTokens: ANTHROPIC_MAX_TOKENS,
  model: getAnthropicModel(),
};

/** True for any active or trialing paid plan (Builder, Pro or Business). */
export function isProUser(user: UserBillingFields): boolean {
  return resolvePlanId(user) !== 'free';
}

export function getAppTier(
  user: UserBillingFields | null | undefined,
): AppTier {
  if (!user) {
    return 'guest';
  }

  return isProUser(user) ? 'pro' : 'free';
}

export function getAgentLimits(tier: AppTier): AgentLimits {
  if (tier === 'pro') {
    return PRO_AGENT_LIMITS;
  }

  return FREE_AGENT_LIMITS;
}

export function canPublishVisibility(
  tier: AppTier,
  visibility: PublishVisibility,
): boolean {
  if (tier === 'pro') {
    return true;
  }

  return visibility === 'private';
}

export function canUseCustomDomain(tier: AppTier): boolean {
  return PLAN_DEFINITIONS[tier === 'pro' ? 'pro' : 'free'].features.customDomains;
}

export const CUSTOM_DOMAIN_UPGRADE_MESSAGE =
  'Custom domains are a Pro feature. Upgrade to Pro to connect your own domain.';

export function getProjectLimit(tier: AppTier): number | null {
  if (tier === 'free') {
    return PLAN_DEFINITIONS.free.limits.projects;
  }

  return null;
}

export function getDailyDesignSuggestionLimit(tier: AppTier): number {
  return PLAN_DEFINITIONS[tier === 'pro' ? 'pro' : 'free'].limits.dailyDesignSuggestions;
}

export function publishUpgradeMessage(visibility: PublishVisibility): string {
  if (visibility === 'public') {
    return 'Public publishing is a Pro feature. Upgrade to Pro to share your project with anyone.';
  }

  if (visibility === 'workspace') {
    return 'Workspace publishing is a Pro feature. Upgrade to Pro to publish to your workspace.';
  }

  return 'Upgrade to Pro for more publishing options.';
}

export function projectLimitMessage(limit: number): string {
  return `Free plan is limited to ${limit} active projects. Upgrade to Pro for unlimited projects.`;
}

export const FREE_PLAN_FEATURES = [
  'Up to 3 active projects',
  'Agent with Economy limits',
  'Plan mode and prompt attachments',
  'Private publish (1 project)',
] as const;

export const PRO_PLAN_FEATURES = [
  'Unlimited projects',
  'Full agent limits and premium models',
  'Public and workspace publishing',
  'Custom domains',
  'Commercial use',
] as const;

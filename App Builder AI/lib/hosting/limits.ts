import type { AppTier } from '@/lib/billing/entitlements';
import { PLAN_DEFINITIONS, GUEST_LIMITS, type PlanId, type PlanLimits } from '@/lib/billing/plans';

export type HostingLimits = {
  /** Custom domains across all of the user's projects. */
  customDomains: number;
  /** Deployment versions kept for history/rollback per project. */
  deploymentsRetained: number;
  /** Environment variables per project per environment. */
  envVarsPerEnvironment: number;
};

function pick(limits: PlanLimits): HostingLimits {
  return {
    customDomains: limits.customDomains,
    deploymentsRetained: limits.deploymentsRetained,
    envVarsPerEnvironment: limits.envVarsPerEnvironment,
  };
}

/** Pass a plan id for exact per-plan limits; a bare tier maps paid users to the Pro plan. */
export function getHostingLimits(tierOrPlan: AppTier | PlanId): HostingLimits {
  if (tierOrPlan === 'guest') return pick(GUEST_LIMITS);
  return pick(PLAN_DEFINITIONS[tierOrPlan].limits);
}

export function customDomainLimitMessage(tier: AppTier, limit: number) {
  if (limit === 0) {
    return 'Custom domains are a Pro feature. Upgrade to Pro to connect your own domain.';
  }
  return `Your ${tier} plan allows up to ${limit} custom domains. Disconnect one or contact support for more.`;
}

export function envVarLimitMessage(tier: AppTier, limit: number) {
  if (tier === 'free') {
    return `Free plan allows ${limit} environment variables per environment. Upgrade to Pro for up to ${PLAN_DEFINITIONS.pro.limits.envVarsPerEnvironment}.`;
  }
  return `You reached the limit of ${limit} environment variables per environment.`;
}

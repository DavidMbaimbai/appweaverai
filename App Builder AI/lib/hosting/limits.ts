import type { AppTier } from '@/lib/billing/entitlements';

export type HostingLimits = {
  /** Custom domains across all of the user's projects. */
  customDomains: number;
  /** Deployment versions kept for history/rollback per project. */
  deploymentsRetained: number;
  /** Environment variables per project per environment. */
  envVarsPerEnvironment: number;
};

const LIMITS: Record<AppTier, HostingLimits> = {
  guest: { customDomains: 0, deploymentsRetained: 1, envVarsPerEnvironment: 0 },
  free: { customDomains: 0, deploymentsRetained: 3, envVarsPerEnvironment: 10 },
  pro: { customDomains: 10, deploymentsRetained: 20, envVarsPerEnvironment: 100 },
};

export function getHostingLimits(tier: AppTier): HostingLimits {
  return LIMITS[tier];
}

export function customDomainLimitMessage(tier: AppTier, limit: number) {
  if (limit === 0) {
    return 'Custom domains are a Pro feature. Upgrade to Pro to connect your own domain.';
  }
  return `Your ${tier} plan allows up to ${limit} custom domains. Disconnect one or contact support for more.`;
}

export function envVarLimitMessage(tier: AppTier, limit: number) {
  if (tier === 'free') {
    return `Free plan allows ${limit} environment variables per environment. Upgrade to Pro for up to ${LIMITS.pro.envVarsPerEnvironment}.`;
  }
  return `You reached the limit of ${limit} environment variables per environment.`;
}

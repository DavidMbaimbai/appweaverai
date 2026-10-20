import type { PaidPlanId } from '@/lib/stripe';

/**
 * Single source of truth for what each plan includes. Every server-side gate
 * (project count, publishing, deployments, custom domains, credits, seats,
 * marketing features) reads from `PLAN_DEFINITIONS` through `lib/billing/gate.ts`.
 *
 * Numbers here are product decisions: change them in this one place only.
 * `null` means unlimited.
 */

export type PlanId = 'free' | PaidPlanId;
export const PLAN_IDS: PlanId[] = ['free', 'builder', 'pro', 'business'];

export type PlanLimits = {
  projects: number | null;
  /** Deployment versions kept per project. */
  deploymentsRetained: number;
  customDomains: number;
  envVarsPerEnvironment: number;
  /** Development credits granted each billing period (0 = no credit metering). */
  creditsPerMonth: number;
  teamSeats: number;
  dailyDesignSuggestions: number;
};

export type PlanFeatures = {
  publishPublic: boolean;
  publishWorkspace: boolean;
  customDomains: boolean;
  fullAgentLimits: boolean;
  commercialUse: boolean;
  /** Marketing features (the marketing wallet is separate and pay-as-you-go). */
  marketingAutopilot: boolean;
  customerAds: boolean;
};

export type PlanDefinition = {
  id: PlanId;
  label: string;
  limits: PlanLimits;
  features: PlanFeatures;
};

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    label: 'Free',
    limits: {
      projects: 3,
      deploymentsRetained: 3,
      customDomains: 0,
      envVarsPerEnvironment: 10,
      creditsPerMonth: 0,
      teamSeats: 1,
      dailyDesignSuggestions: 10,
    },
    features: {
      publishPublic: false,
      publishWorkspace: false,
      customDomains: false,
      fullAgentLimits: false,
      commercialUse: false,
      marketingAutopilot: true,
      customerAds: true,
    },
  },
  builder: {
    id: 'builder',
    label: 'Builder',
    limits: {
      projects: null,
      deploymentsRetained: 10,
      customDomains: 3,
      envVarsPerEnvironment: 100,
      creditsPerMonth: 1200,
      teamSeats: 2,
      dailyDesignSuggestions: 100,
    },
    features: {
      publishPublic: true,
      publishWorkspace: true,
      customDomains: true,
      fullAgentLimits: true,
      commercialUse: true,
      marketingAutopilot: true,
      customerAds: true,
    },
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    limits: {
      projects: null,
      deploymentsRetained: 20,
      customDomains: 10,
      envVarsPerEnvironment: 100,
      creditsPerMonth: 4000,
      teamSeats: 5,
      dailyDesignSuggestions: 100,
    },
    features: {
      publishPublic: true,
      publishWorkspace: true,
      customDomains: true,
      fullAgentLimits: true,
      commercialUse: true,
      marketingAutopilot: true,
      customerAds: true,
    },
  },
  business: {
    id: 'business',
    label: 'Business',
    limits: {
      projects: null,
      deploymentsRetained: 50,
      customDomains: 25,
      envVarsPerEnvironment: 200,
      creditsPerMonth: 10000,
      teamSeats: 25,
      dailyDesignSuggestions: 200,
    },
    features: {
      publishPublic: true,
      publishWorkspace: true,
      customDomains: true,
      fullAgentLimits: true,
      commercialUse: true,
      marketingAutopilot: true,
      customerAds: true,
    },
  },
};

/** Signed-out visitors get the most restrictive limits. */
export const GUEST_LIMITS: PlanLimits = {
  ...PLAN_DEFINITIONS.free.limits,
  deploymentsRetained: 1,
  envVarsPerEnvironment: 0,
};

export type BillingFields = {
  subscriptionPlan: string;
  subscriptionStatus: string | null;
};

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as string[]).includes(value);
}

/** The plan a user is currently entitled to: a paid plan only while its subscription is active or trialing. */
export function resolvePlanId(user: BillingFields | null | undefined): PlanId {
  if (!user) return 'free';
  const active = user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing';
  if (!active) return 'free';
  return isPlanId(user.subscriptionPlan) ? user.subscriptionPlan : 'free';
}

/** Cheapest plan that unlocks a feature, for upgrade prompts. */
export function cheapestPlanWith(feature: keyof PlanFeatures): PlanDefinition {
  return PLAN_IDS.map((id) => PLAN_DEFINITIONS[id]).find((p) => p.features[feature]) ?? PLAN_DEFINITIONS.pro;
}

/** Cheapest plan whose limit satisfies `needed`. */
export function cheapestPlanForLimit(limit: keyof PlanLimits, needed: number): PlanDefinition {
  return (
    PLAN_IDS.map((id) => PLAN_DEFINITIONS[id]).find((p) => {
      const value = p.limits[limit];
      return value === null || value >= needed;
    }) ?? PLAN_DEFINITIONS.business
  );
}

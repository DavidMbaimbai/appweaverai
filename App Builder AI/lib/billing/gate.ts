import {
  PLAN_DEFINITIONS,
  cheapestPlanForLimit,
  cheapestPlanWith,
  resolvePlanId,
  type BillingFields,
  type PlanDefinition,
  type PlanFeatures,
  type PlanId,
  type PlanLimits,
} from '@/lib/billing/plans';
import { prisma } from '@/lib/prisma';

/**
 * Central entitlement gate. Every server-side plan-gated action must resolve
 * entitlements here and use `checkLimit` / `checkFeature`; the UI only reflects
 * the result. See `gate.test.ts` for the list of actions that must call it.
 */

export const UPGRADE_PATH = '/app/billing';

export type Entitlements = {
  planId: PlanId;
  plan: PlanDefinition;
  limits: PlanLimits;
  features: PlanFeatures;
};

export type GateResult =
  | { allowed: true }
  | {
      allowed: false;
      code: 'LIMIT_REACHED' | 'FEATURE_LOCKED';
      message: string;
      upgradeTo: PlanId;
      upgradePath: string;
    };

export function resolveEntitlements(user: BillingFields | null | undefined): Entitlements {
  const planId = resolvePlanId(user);
  const plan = PLAN_DEFINITIONS[planId];
  return { planId, plan, limits: plan.limits, features: plan.features };
}

export async function getUserEntitlements(userId: string): Promise<Entitlements> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionPlan: true, subscriptionStatus: true },
  });
  return resolveEntitlements(user);
}

const LIMIT_NOUNS: Record<keyof PlanLimits, string> = {
  projects: 'active projects',
  deploymentsRetained: 'retained deployments per project',
  customDomains: 'custom domains',
  envVarsPerEnvironment: 'environment variables per environment',
  creditsPerMonth: 'credits per month',
  teamSeats: 'team seats',
  dailyDesignSuggestions: 'AI helper requests per day',
};

const FEATURE_NAMES: Record<keyof PlanFeatures, string> = {
  publishPublic: 'Public publishing',
  publishWorkspace: 'Workspace publishing',
  customDomains: 'Custom domains',
  fullAgentLimits: 'Full agent limits',
  commercialUse: 'Commercial use',
  marketingAutopilot: 'Marketing autopilot',
  customerAds: 'Customer ads',
};

/** `current` is how many the user already has; creating one more is allowed only while current < limit. */
export function checkLimit(ent: Entitlements, limit: keyof PlanLimits, current: number): GateResult {
  const max = ent.limits[limit];
  if (max === null || current < max) return { allowed: true };
  const next = cheapestPlanForLimit(limit, current + 1);
  const upgradeTo = next.id === ent.planId ? 'business' : next.id;
  return {
    allowed: false,
    code: 'LIMIT_REACHED',
    message: `Your ${ent.plan.label} plan includes ${max} ${LIMIT_NOUNS[limit]}. Upgrade to ${PLAN_DEFINITIONS[upgradeTo].label} for more at ${UPGRADE_PATH}.`,
    upgradeTo,
    upgradePath: UPGRADE_PATH,
  };
}

export function checkFeature(ent: Entitlements, feature: keyof PlanFeatures): GateResult {
  if (ent.features[feature]) return { allowed: true };
  const upgradeTo = cheapestPlanWith(feature).id;
  return {
    allowed: false,
    code: 'FEATURE_LOCKED',
    message: `${FEATURE_NAMES[feature]} is not included in the ${ent.plan.label} plan. Upgrade to ${PLAN_DEFINITIONS[upgradeTo].label} at ${UPGRADE_PATH}.`,
    upgradeTo,
    upgradePath: UPGRADE_PATH,
  };
}

/** Throws when blocked; for server code that prefers exceptions over result objects. */
export class EntitlementError extends Error {
  constructor(public readonly gate: Extract<GateResult, { allowed: false }>) {
    super(gate.message);
    this.name = 'EntitlementError';
  }
}

export function assertAllowed(result: GateResult): asserts result is { allowed: true } {
  if (!result.allowed) throw new EntitlementError(result);
}

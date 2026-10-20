import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkFeature, checkLimit, resolveEntitlements, assertAllowed, EntitlementError } from './gate';
import { PLAN_DEFINITIONS } from './plans';

const ent = (plan: string, status = 'active') => resolveEntitlements({ subscriptionPlan: plan, subscriptionStatus: status });

describe('entitlement gate', () => {
  it('blocks a free user at the project limit with an upgrade target', () => {
    const free = ent('free');
    const max = PLAN_DEFINITIONS.free.limits.projects as number;
    expect(checkLimit(free, 'projects', max - 1)).toEqual({ allowed: true });
    const blocked = checkLimit(free, 'projects', max);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.code).toBe('LIMIT_REACHED');
      expect(blocked.upgradePath).toBe('/app/billing');
      expect(blocked.upgradeTo).not.toBe('free');
      expect(blocked.message).toContain('Upgrade');
    }
  });

  it('locks custom domains on free and opens them on paid plans', () => {
    const locked = checkFeature(ent('free'), 'customDomains');
    expect(locked.allowed).toBe(false);
    for (const plan of ['builder', 'pro', 'business']) expect(checkFeature(ent(plan), 'customDomains')).toEqual({ allowed: true });
  });

  it('treats a canceled or unpaid subscription as the free plan', () => {
    expect(ent('pro', 'canceled').planId).toBe('free');
    expect(ent('business', 'past_due').planId).toBe('free');
  });

  it('recognises Builder and Business subscribers as paid, not free', () => {
    expect(ent('builder').planId).toBe('builder');
    expect(ent('business').planId).toBe('business');
  });

  it('assertAllowed throws EntitlementError carrying the gate result', () => {
    const blocked = checkFeature(ent('free'), 'customDomains');
    expect(() => assertAllowed(blocked)).toThrow(EntitlementError);
  });
});

describe('plan-gated actions use the central entitlement source', () => {
  const root = process.cwd();
  const sources: Record<string, RegExp> = {
    'app/api/projects/[projectId]/custom-domain/route.ts': /@\/lib\/billing\/gate/,
    'lib/actions/projects.ts': /getProjectLimit/,
    'lib/actions/duplicate.ts': /getProjectLimit/,
    'lib/actions/remix.ts': /getProjectLimit/,
    'lib/actions/templates.ts': /getProjectLimit/,
    'lib/actions/staging.ts': /getHostingLimits|resolvePlanId/,
    'lib/actions/publish.ts': /getHostingLimits|resolvePlanId/,
    'lib/actions/deployments.ts': /getHostingLimits|resolvePlanId/,
    'app/api/projects/[projectId]/env/route.ts': /getHostingLimits/,
    'lib/ai/daily-limit.ts': /getDailyDesignSuggestionLimit/,
  };

  for (const [file, pattern] of Object.entries(sources)) {
    it(`${file} calls the entitlement helper`, () => {
      expect(readFileSync(join(root, file), 'utf8')).toMatch(pattern);
    });
  }

  it('does not hard-code plan limits outside plans.ts', () => {
    const limits = readFileSync(join(root, 'lib/hosting/limits.ts'), 'utf8');
    expect(limits).toContain('PLAN_DEFINITIONS');
    expect(limits).not.toMatch(/retainedDeployments:\s*\d/);
  });
});

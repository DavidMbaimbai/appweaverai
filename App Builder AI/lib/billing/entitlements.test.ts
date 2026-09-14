import { describe, expect, it } from 'vitest';

import {
  FREE_PROJECT_LIMIT,
  canPublishVisibility,
  getAgentLimits,
  getAppTier,
  getProjectLimit,
  isProUser,
  projectLimitMessage,
  publishUpgradeMessage,
} from '@/lib/billing/entitlements';

describe('isProUser', () => {
  it('is true for an active pro subscription', () => {
    expect(
      isProUser({ subscriptionPlan: 'pro', subscriptionStatus: 'active' }),
    ).toBe(true);
  });

  it('is true for a trialing pro subscription', () => {
    expect(
      isProUser({ subscriptionPlan: 'pro', subscriptionStatus: 'trialing' }),
    ).toBe(true);
  });

  it('is false for a canceled pro subscription', () => {
    expect(
      isProUser({ subscriptionPlan: 'pro', subscriptionStatus: 'canceled' }),
    ).toBe(false);
  });

  it('is false for a free plan even with an active status', () => {
    expect(
      isProUser({ subscriptionPlan: 'free', subscriptionStatus: 'active' }),
    ).toBe(false);
  });

  it('is false when subscriptionStatus is null', () => {
    expect(isProUser({ subscriptionPlan: 'pro', subscriptionStatus: null })).toBe(
      false,
    );
  });
});

describe('getAppTier', () => {
  it('returns "guest" for no user', () => {
    expect(getAppTier(null)).toBe('guest');
    expect(getAppTier(undefined)).toBe('guest');
  });

  it('returns "pro" for an active pro user', () => {
    expect(
      getAppTier({ subscriptionPlan: 'pro', subscriptionStatus: 'active' }),
    ).toBe('pro');
  });

  it('returns "free" for a non-pro signed-in user', () => {
    expect(
      getAppTier({ subscriptionPlan: 'free', subscriptionStatus: null }),
    ).toBe('free');
  });
});

describe('getAgentLimits', () => {
  it('gives pro tier higher limits than free tier', () => {
    const free = getAgentLimits('free');
    const pro = getAgentLimits('pro');
    expect(pro.maxTurns).toBeGreaterThanOrEqual(free.maxTurns);
    expect(pro.maxTokens).toBeGreaterThanOrEqual(free.maxTokens);
  });

  it('treats guest the same as free', () => {
    expect(getAgentLimits('guest')).toEqual(getAgentLimits('free'));
  });
});

describe('canPublishVisibility', () => {
  it('allows pro users to publish any visibility', () => {
    expect(canPublishVisibility('pro', 'private')).toBe(true);
    expect(canPublishVisibility('pro', 'workspace')).toBe(true);
    expect(canPublishVisibility('pro', 'public')).toBe(true);
  });

  it('restricts free users to private publishing only', () => {
    expect(canPublishVisibility('free', 'private')).toBe(true);
    expect(canPublishVisibility('free', 'workspace')).toBe(false);
    expect(canPublishVisibility('free', 'public')).toBe(false);
  });

  it('restricts guests the same as free users', () => {
    expect(canPublishVisibility('guest', 'public')).toBe(false);
  });
});

describe('getProjectLimit', () => {
  it('caps free-tier projects at FREE_PROJECT_LIMIT', () => {
    expect(getProjectLimit('free')).toBe(FREE_PROJECT_LIMIT);
  });

  it('has no limit for pro users', () => {
    expect(getProjectLimit('pro')).toBeNull();
  });
});

describe('publishUpgradeMessage / projectLimitMessage', () => {
  it('mentions "Public" for public visibility upsell', () => {
    expect(publishUpgradeMessage('public')).toMatch(/Public publishing/);
  });

  it('mentions "Workspace" for workspace visibility upsell', () => {
    expect(publishUpgradeMessage('workspace')).toMatch(/Workspace publishing/);
  });

  it('includes the numeric limit in the project limit message', () => {
    expect(projectLimitMessage(3)).toContain('3 active projects');
  });
});

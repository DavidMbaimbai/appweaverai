import { describe, expect, it } from 'vitest';

import { classifyRisk, decide, type PolicyInput } from '@/lib/agents/policy';
import { AGENT_MODES, HIGH_RISK_KINDS } from '@/lib/agents/types';

const base: PolicyInput = {
  mode: 'AUTONOMOUS',
  enabled: true,
  paused: false,
  category: 'social_post',
  actionRisk: 'LOW',
  withinLimits: true,
  globalPause: false,
  autonomousCategories: ['social_post'],
};

describe('decide', () => {
  it('executes allowed low-risk autonomous actions', () => {
    expect(decide(base).outcome).toBe('EXECUTE');
  });

  it('needs approval for categories that are not allowed autonomously', () => {
    expect(decide({ ...base, category: 'customer_reply' }).outcome).toBe('NEEDS_APPROVAL');
    expect(decide({ ...base, autonomousCategories: null }).outcome).toBe('NEEDS_APPROVAL');
  });

  it('blocks on global pause, disabled, paused and limits in that order', () => {
    expect(decide({ ...base, globalPause: true, enabled: false }).reason).toMatch(/kill switch/);
    expect(decide({ ...base, enabled: false }).outcome).toBe('BLOCKED');
    expect(decide({ ...base, paused: true }).outcome).toBe('BLOCKED');
    expect(decide({ ...base, withinLimits: false }).outcome).toBe('BLOCKED');
  });

  it('drafts only in ASSIST and asks in APPROVAL', () => {
    expect(decide({ ...base, mode: 'ASSIST' }).outcome).toBe('DRAFT_ONLY');
    expect(decide({ ...base, mode: 'APPROVAL' }).outcome).toBe('NEEDS_APPROVAL');
  });

  it('never executes high-risk actions in any mode', () => {
    for (const mode of AGENT_MODES) {
      expect(decide({ ...base, mode, actionRisk: 'HIGH' }).outcome).not.toBe('EXECUTE');
    }
    expect(decide({ ...base, actionRisk: 'HIGH' }).outcome).toBe('NEEDS_APPROVAL');
    expect(decide({ ...base, mode: 'ASSIST', actionRisk: 'HIGH' }).outcome).toBe('DRAFT_ONLY');
  });

  it('never auto-replies to reviews on the platform scope', () => {
    const review = { ...base, category: 'review_reply', autonomousCategories: ['review_reply'] };
    expect(decide({ ...review, scope: 'PLATFORM' }).outcome).toBe('DRAFT_ONLY');
    expect(decide({ ...review, scope: 'PROJECT' }).outcome).toBe('EXECUTE');
  });
});

describe('classifyRisk', () => {
  it('treats every high-risk kind as HIGH', () => {
    for (const kind of HIGH_RISK_KINDS) expect(classifyRisk([kind])).toBe('HIGH');
    expect(classifyRisk(['post'])).toBe('LOW');
    expect(classifyRisk([], 'MEDIUM')).toBe('MEDIUM');
  });
});

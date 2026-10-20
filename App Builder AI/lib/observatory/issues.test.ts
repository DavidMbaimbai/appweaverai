import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  issueFind: vi.fn(),
  issueUpdate: vi.fn(),
  deploymentFind: vi.fn(),
  smokeFind: vi.fn(),
}));

vi.mock('@/lib/anthropic', () => ({ getAnthropicClient: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectIssue: { findUnique: m.issueFind, update: m.issueUpdate },
    deployment: { findFirst: m.deploymentFind },
    smokeCheck: { findMany: m.smokeFind },
  },
}));

import { canTransition, isDefectReview, parseIssueAnalysis, verifyIssue } from './issues';

describe('canTransition', () => {
  it('requires approval and deployment before verification', () => {
    expect(canTransition('FIX_PROPOSED', 'APPROVED')).toBe(true);
    expect(canTransition('FIX_PROPOSED', 'DEPLOYED')).toBe(false);
    expect(canTransition('APPROVED', 'VERIFIED')).toBe(false);
    expect(canTransition('DEPLOYED', 'VERIFIED')).toBe(true);
  });
});

describe('isDefectReview', () => {
  it('only treats negative defect-like topics as defects', () => {
    expect(isDefectReview('usability', 'negative')).toBe(true);
    expect(isDefectReview('price', 'negative')).toBe(false);
    expect(isDefectReview('usability', 'positive')).toBe(false);
  });
});

describe('parseIssueAnalysis', () => {
  it('formats a numbered plan and rejects plan-less output', () => {
    expect(parseIssueAnalysis('{"analysis":"A","plan":["one","two"]}')).toEqual({ analysis: 'A', plan: '1. one\n2. two' });
    expect(parseIssueAnalysis('{"analysis":"A","plan":[]}')).toBeNull();
  });
});

describe('verifyIssue', () => {
  const deployedAt = new Date('2026-02-01T00:00:00Z');
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.issueUpdate.mockImplementation(async ({ data }) => ({ id: 'i1', projectId: 'p1', ...data }));
  });

  it('does not verify without a later passing smoke check', async () => {
    m.issueFind.mockResolvedValue({ id: 'i1', projectId: 'p1', status: 'DEPLOYED', deployedAt });
    m.smokeFind.mockResolvedValue([]);
    expect((await verifyIssue('i1')).verified).toBe(false);
    expect(m.issueUpdate).not.toHaveBeenCalled();

    m.smokeFind.mockResolvedValue([{ id: 's1', outcome: 'CONFIRMED_FAILURE', checkedAt: new Date('2026-02-02T00:00:00Z') }]);
    expect((await verifyIssue('i1')).verified).toBe(false);
  });

  it('verifies when a later smoke check passed', async () => {
    m.issueFind.mockResolvedValue({ id: 'i1', projectId: 'p1', status: 'DEPLOYED', deployedAt });
    m.smokeFind.mockResolvedValue([{ id: 's2', outcome: 'PASS', checkedAt: new Date('2026-02-02T00:00:00Z') }]);
    expect((await verifyIssue('i1')).verified).toBe(true);
    expect(m.issueUpdate.mock.calls[0][0].data).toMatchObject({ status: 'VERIFIED', verifiedByCheckId: 's2' });
  });

  it('refuses to move an approved issue forward without a newer deployment', async () => {
    m.issueFind.mockResolvedValue({ id: 'i1', projectId: 'p1', status: 'APPROVED', approvedAt: deployedAt });
    m.deploymentFind.mockResolvedValue(null);
    const res = await verifyIssue('i1');
    expect(res.verified).toBe(false);
    expect(m.issueUpdate).not.toHaveBeenCalled();
  });
});

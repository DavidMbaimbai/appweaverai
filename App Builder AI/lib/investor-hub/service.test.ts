import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  investorFindFirst: vi.fn(),
  investorCreate: vi.fn(),
  investorUpdateMany: vi.fn(),
  profileFind: vi.fn(),
  suppressionFind: vi.fn(),
  activityCreate: vi.fn(),
  replyCreate: vi.fn(),
  outreachUpdateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    hubInvestor: { findFirst: m.investorFindFirst, create: m.investorCreate, updateMany: m.investorUpdateMany },
    investorHubProfile: { findUnique: m.profileFind },
    outreachSuppression: { findUnique: m.suppressionFind },
    hubInvestorActivity: { create: m.activityCreate },
    hubInvestorReply: { create: m.replyCreate },
    hubInvestorOutreach: { updateMany: m.outreachUpdateMany },
    hubInvestorContact: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));
vi.mock('@/lib/outreach/process', () => ({ suppress: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/anthropic', () => ({ getAnthropicClient: vi.fn() }));

import { recordReply } from './replies';
import { addInvestor, requireInvestor, updateInvestor } from './service';

const ctx = { userId: 'u1', projectId: 'p1' };

describe('investor hub service (mocked prisma)', () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.profileFind.mockResolvedValue(null);
    m.suppressionFind.mockResolvedValue(null);
    m.activityCreate.mockResolvedValue({});
    m.investorUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('scopes lookups by user AND project and 404s for foreign rows', async () => {
    m.investorFindFirst.mockResolvedValue(null);
    await expect(requireInvestor(ctx, 'x')).rejects.toMatchObject({ status: 404 });
    expect(m.investorFindFirst).toHaveBeenCalledWith({ where: { id: 'x', userId: 'u1', projectId: 'p1' } });
  });

  it('prevents duplicates by normalised domain or email', async () => {
    m.investorFindFirst.mockResolvedValue({ id: 'existing' });
    const res = await addInvestor(ctx, { name: 'A', website: 'https://www.acme.vc/team', email: 'A@Acme.vc' });
    expect(res).toEqual({ created: false, id: 'existing' });
    expect(m.investorFindFirst.mock.calls[0][0].where).toMatchObject({
      userId: 'u1', projectId: 'p1', OR: [{ domain: 'acme.vc' }, { emailKey: 'a@acme.vc' }],
    });
    expect(m.investorCreate).not.toHaveBeenCalled();
  });

  it('creates unverified investors with per-field provenance', async () => {
    m.investorFindFirst.mockResolvedValue(null);
    m.investorCreate.mockResolvedValue({ id: 'n1' });
    const at = new Date('2026-01-01T00:00:00Z');
    await addInvestor(ctx, { name: 'A', email: 'a@acme.vc', sectors: ['fintech'] }, { sourceUrl: 'https://src.example/p', verifiedAt: at });
    const data = m.investorCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', projectId: 'p1', sourceUrl: 'https://src.example/p' });
    expect(data.fieldMeta.email).toEqual({ sourceUrl: 'https://src.example/p', lastVerifiedAt: at.toISOString(), verified: false });
    expect(data.fieldMeta.sectors.verified).toBe(false);
  });

  it('refuses FUNDING_SECURED without explicit confirmation', async () => {
    m.investorFindFirst.mockResolvedValue({ id: 'i', pipelineStage: 'NEGOTIATION', emailKey: null });
    await expect(updateInvestor(ctx, 'i', { stage: 'FUNDING_SECURED' })).rejects.toThrow(/Confirm/);
  });

  it('applies unsubscribe immediately: opt-out, stop sequence, cancel drafts, decline', async () => {
    m.investorFindFirst.mockResolvedValue({ id: 'i', pipelineStage: 'CONTACTED' });
    m.replyCreate.mockResolvedValue({});
    m.outreachUpdateMany.mockResolvedValue({ count: 1 });
    const res = await recordReply(ctx, 'i', 'Please remove me, unsubscribe');
    expect(res.classification).toBe('unsubscribe');
    expect(m.investorUpdateMany).toHaveBeenCalledWith({
      where: { id: 'i', userId: 'u1', projectId: 'p1' },
      data: { sequenceActive: false, nextFollowUpAt: null, optedOut: true },
    });
    expect(m.outreachUpdateMany.mock.calls[0][0].data).toEqual({ status: 'CANCELLED' });
    expect(m.investorUpdateMany).toHaveBeenCalledWith({
      where: { id: 'i', userId: 'u1', projectId: 'p1' },
      data: { pipelineStage: 'DECLINED' },
    });
  });
});

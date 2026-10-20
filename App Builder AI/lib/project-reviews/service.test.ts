import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  reviewFind: vi.fn(),
  reviewUpdate: vi.fn(),
  settingsFind: vi.fn(),
  usageCount: vi.fn(),
  projectFind: vi.fn(),
  analyze: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectReview: { findUnique: m.reviewFind, update: m.reviewUpdate },
    projectReviewSettings: { findUnique: m.settingsFind },
    aiUsageEvent: { count: m.usageCount },
    project: { findUnique: m.projectFind },
  },
}));
vi.mock('@/lib/email', () => ({ sendEmail: m.sendEmail }));
vi.mock('./ai', () => ({ analyzeReview: m.analyze }));

import { processNewReview } from './service';

const review = { id: 'r1', projectId: 'p1', rating: 5, authorName: 'Ann', authorEmail: 'ann@x.com', body: 'Great!' };

describe('processNewReview', () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.reviewFind.mockResolvedValue(review);
    m.usageCount.mockResolvedValue(0);
    m.reviewUpdate.mockResolvedValue(review);
    m.projectFind.mockResolvedValue({
      name: 'Shop',
      slug: 's',
      notificationEmail: 'owner@x.com',
      createdBy: { email: 'o@x.com' },
      workspace: { slug: 'w', owner: { email: 'w@x.com' } },
      reviewSettings: null,
    });
  });

  it('holds replies by default (autoReplyPositive false): nothing is sent', async () => {
    m.settingsFind.mockResolvedValue({ enabled: true, autoReplyPositive: false, businessInfo: '', tone: 'friendly' });
    m.analyze.mockResolvedValue({ topic: 'service', sentiment: 'positive', urgency: 'low', reply: 'Thanks!' });
    await processNewReview('r1');
    expect(m.reviewUpdate).toHaveBeenCalledTimes(1);
    expect(m.reviewUpdate.mock.calls[0][0].data.replyStatus).toBe('DRAFT');
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('auto-sends a clean positive review when opted in', async () => {
    m.settingsFind.mockResolvedValue({ enabled: true, autoReplyPositive: true, businessInfo: '', tone: 'friendly' });
    m.analyze.mockResolvedValue({ topic: 'service', sentiment: 'positive', urgency: 'low', reply: 'Thanks!' });
    m.reviewUpdate.mockResolvedValue({ authorEmail: 'ann@x.com', authorName: 'Ann', projectId: 'p1' });
    await processNewReview('r1');
    expect(m.reviewUpdate.mock.calls[1][0].data).toEqual({ reply: 'Thanks!', replyStatus: 'SENT', repliedAt: expect.any(Date) });
    expect(m.sendEmail.mock.calls[0][0].to).toBe('ann@x.com');
  });

  it('never auto-sends flagged text and notifies the owner', async () => {
    m.reviewFind.mockResolvedValue({ ...review, body: 'I want a refund' });
    m.settingsFind.mockResolvedValue({ enabled: true, autoReplyPositive: true, businessInfo: '', tone: 'friendly' });
    m.analyze.mockResolvedValue({ topic: 'other', sentiment: 'positive', urgency: 'low', reply: 'Thanks!' });
    await processNewReview('r1');
    expect(m.reviewUpdate).toHaveBeenCalledTimes(1);
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    expect(m.sendEmail.mock.calls[0][0].to).toBe('owner@x.com');
  });

  it('holds when the AI call fails', async () => {
    m.settingsFind.mockResolvedValue({ enabled: true, autoReplyPositive: true, businessInfo: '', tone: 'friendly' });
    m.analyze.mockRejectedValue(new Error('boom'));
    await processNewReview('r1');
    expect(m.reviewUpdate).toHaveBeenCalledTimes(1);
    expect(m.reviewUpdate.mock.calls[0][0].data.replyStatus).toBe('NONE');
  });
});

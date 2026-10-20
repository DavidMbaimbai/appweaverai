import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  investorLead: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  outreachSuppression: { findUnique: vi.fn(), upsert: vi.fn() },
}));
const sendEmail = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/email', () => ({ sendEmail }));

import { parseLeadsCsv } from '@/lib/outreach/csv';
import { reviewLead } from '@/lib/outreach/process';

const lead = {
  id: 'l1',
  email: 'jane@fund.com',
  subject: 'Hello',
  body: 'Body text',
  status: 'SENDING',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OUTREACH_SECRET = 'test-secret';
  process.env.OUTREACH_POSTAL_ADDRESS = '1 Main St';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASSWORD = 'p';
  prisma.investorLead.count.mockResolvedValue(0);
  prisma.investorLead.updateMany.mockResolvedValue({ count: 1 });
  prisma.investorLead.findUniqueOrThrow.mockResolvedValue(lead);
  prisma.outreachSuppression.findUnique.mockResolvedValue(null);
});

describe('reviewLead approve', () => {
  it('sends with footer and opt-out headers, then marks SENT', async () => {
    expect(await reviewLead('l1', { action: 'approve' })).toEqual({ ok: true });
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('jane@fund.com');
    expect(mail.text).toContain('1 Main St');
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(prisma.investorLead.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('never sends to a suppressed address', async () => {
    prisma.outreachSuppression.findUnique.mockResolvedValue({ email: 'jane@fund.com' });
    expect(await reviewLead('l1', { action: 'approve' })).toEqual({ ok: false, error: 'suppressed' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses without a postal address', async () => {
    delete process.env.OUTREACH_POSTAL_ADDRESS;
    expect(await reviewLead('l1', { action: 'approve' })).toEqual({ ok: false, error: 'not-configured' });
    expect(prisma.investorLead.updateMany).not.toHaveBeenCalled();
  });

  it('releases the lead when the daily limit is hit after claiming', async () => {
    prisma.investorLead.count.mockResolvedValueOnce(0).mockResolvedValueOnce(999);
    expect(await reviewLead('l1', { action: 'approve' })).toEqual({ ok: false, error: 'daily-limit' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prisma.investorLead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }),
    );
  });

  it('returns the lead to the queue when SMTP fails', async () => {
    sendEmail.mockRejectedValue(new Error('boom'));
    expect(await reviewLead('l1', { action: 'approve' })).toEqual({ ok: false, error: 'send-failed' });
    expect(prisma.investorLead.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }),
    );
  });

  it('does not send twice when another request already claimed it', async () => {
    prisma.investorLead.updateMany.mockResolvedValue({ count: 0 });
    expect(await reviewLead('l1', { action: 'approve' })).toEqual({ ok: false, error: 'not-reviewable' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('parseLeadsCsv', () => {
  it('maps headers, handles quotes, and drops rows without a name', () => {
    const leads = parseLeadsCsv('Name,Company,Email\n"Doe, Jane",Fund,jane@fund.com\n,NoName,x@y.com\n');
    expect(leads).toEqual([{ name: 'Doe, Jane', firm: 'Fund', email: 'jane@fund.com' }]);
  });
});

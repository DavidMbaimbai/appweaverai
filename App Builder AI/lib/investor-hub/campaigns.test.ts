import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  p: {
    investorCampaign: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    investorCampaignTarget: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    investorCampaignSend: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    hubInvestor: { findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    hubInvestorReply: { count: vi.fn() },
    hubInvestorOutreach: { create: vi.fn() },
    hubInvestorActivity: { create: vi.fn() },
    investorHubProfile: { findUnique: vi.fn() },
    outreachSuppression: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: m.p }));
vi.mock('@/lib/marketing-credits/run', () => ({
  withMarketingCredits: async (_o: unknown, fn: () => Promise<unknown>) => ({ ok: true, value: await fn(), charged: 0 }),
}));
vi.mock('@/lib/email', () => ({ sendEmail: m.sendEmail }));
vi.mock('@/lib/anthropic', () => ({ getAnthropicClient: vi.fn() }));

import { composeCampaignEmail } from './campaign-email';
import {
  campaignSendBlock,
  insideCampaignWindow,
  nextStepDelayDays,
  normalizeSettings,
  renderTemplate,
  shouldPauseForBounces,
  targetBlockReason,
} from './campaign-rules';
import { runInvestorCampaigns, sendToTarget } from './campaigns';

const TUE_10_UTC = new Date('2026-10-20T10:00:00Z');
const SAT_10_UTC = new Date('2026-10-24T10:00:00Z');

const campaign = {
  id: 'c1', userId: 'u1', projectId: 'p1', name: 'Seed', status: 'RUNNING',
  templateSubject: 'About {{company}}', templateBody: 'Hi {{firstName}}, we build {{company}}. Relevant to {{firm}}?\n\nBest regards,',
  variants: [], followUpBody: '', dailyLimit: 20, sendWindowStart: 9, sendWindowEnd: 17, timezone: 'UTC',
  followUpDays: [4, 7], maxFollowUps: 2, approvedAt: new Date('2026-10-19T00:00:00Z'), acknowledgedAt: new Date('2026-10-19T00:00:00Z'),
} as never;
const target = { id: 't1', campaignId: 'c1', investorId: 'i1', email: 'jane@fund.com', sourceUrl: 'https://fund.com/team', status: 'ACTIVE', stepsSent: 0 } as never;
const investor = { id: 'i1', name: 'Jane Doe', firm: 'Fund', emailKey: 'jane@fund.com', optedOut: false, sequenceActive: true, pipelineStage: 'DISCOVERED' };
const ctx = { userId: 'u1', projectId: 'p1' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OUTREACH_SECRET = 'secret';
  process.env.OUTREACH_POSTAL_ADDRESS = '1 Main St, Springfield';
  process.env.SMTP_HOST = 'smtp';
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASSWORD = 'p';
  m.p.hubInvestor.findFirst.mockResolvedValue(investor);
  m.p.hubInvestorReply.count.mockResolvedValue(0);
  m.p.outreachSuppression.findUnique.mockResolvedValue(null);
  m.p.investorCampaignSend.findUnique.mockResolvedValue(null);
  m.p.investorCampaignSend.create.mockResolvedValue({});
  m.p.investorCampaignSend.updateMany.mockResolvedValue({ count: 1 });
  m.p.investorCampaignTarget.update.mockResolvedValue({});
  m.p.hubInvestorOutreach.create.mockResolvedValue({});
  m.p.hubInvestorActivity.create.mockResolvedValue({});
});

describe('campaign eligibility and settings', () => {
  it('requires a public business email with an https source', () => {
    const ok = { email: 'jane@fund.com', sourceUrl: 'https://fund.com/team', optedOut: false, suppressed: false };
    expect(targetBlockReason(ok)).toBeNull();
    expect(targetBlockReason({ ...ok, email: 'jane@gmail.com' })).toMatch(/webmail/);
    expect(targetBlockReason({ ...ok, sourceUrl: null })).toMatch(/source/);
    expect(targetBlockReason({ ...ok, sourceUrl: 'http://x.com' })).toMatch(/source/);
    expect(targetBlockReason({ ...ok, optedOut: true })).toMatch(/opted out/);
    expect(targetBlockReason({ ...ok, suppressed: true })).toMatch(/suppression/);
  });

  it('clamps limits: daily <= 50, follow-ups <= 2, rejects bad zones', () => {
    const r = normalizeSettings({ dailyLimit: 500, maxFollowUps: 9, followUpDays: [3, 5, 9], timezone: 'Europe/Paris' });
    expect(r.ok && r.value).toMatchObject({ dailyLimit: 50, maxFollowUps: 2, followUpDays: [3, 5] });
    expect(normalizeSettings({ timezone: 'Mars/Base' }).ok).toBe(false);
    expect(normalizeSettings({ sendWindowStart: 17, sendWindowEnd: 9 }).ok).toBe(false);
  });

  it('applies the send window per time zone and skips weekends', () => {
    expect(insideCampaignWindow(TUE_10_UTC, 'UTC', 9, 17)).toBe(true);
    expect(insideCampaignWindow(TUE_10_UTC, 'America/New_York', 9, 17)).toBe(false); // 06:00 local
    expect(insideCampaignWindow(SAT_10_UTC, 'UTC', 9, 17)).toBe(false);
    expect(insideCampaignWindow(new Date('2026-10-20T17:00:00Z'), 'UTC', 9, 17)).toBe(false);
  });

  it('never renders a template with a missing merge field', () => {
    expect(renderTemplate('Hi {{firstName}} at {{firm}}', { firstName: 'Jane', firm: null })).toBeNull();
    expect(renderTemplate('Hi {{nope}}', { firstName: 'Jane' })).toBeNull();
    expect(renderTemplate('Hi {{firstName}}', { firstName: 'Jane' })).toBe('Hi Jane');
  });

  it('pauses when bounces exceed 5% of a meaningful sample', () => {
    expect(shouldPauseForBounces(40, 2)).toBe(false);
    expect(shouldPauseForBounces(10, 1)).toBe(true);
    expect(shouldPauseForBounces(5, 1)).toBe(false);
    expect(shouldPauseForBounces(5, 2)).toBe(true);
    expect(nextStepDelayDays(1, [4, 7], 2)).toBe(4);
    expect(nextStepDelayDays(3, [4, 7], 2)).toBeNull();
  });

  it('blocks sending on opt-out, reply, and repeated step', () => {
    const base = { campaignStatus: 'RUNNING', targetStatus: 'ACTIVE', optedOut: false, sequenceActive: true, suppressed: false, replied: false, alreadySentStep: false, step: 0, maxFollowUps: 2 };
    expect(campaignSendBlock(base)).toBeNull();
    expect(campaignSendBlock({ ...base, campaignStatus: 'PAUSED' })).not.toBeNull();
    expect(campaignSendBlock({ ...base, suppressed: true })?.stop).toBe('STOPPED_OPTOUT');
    expect(campaignSendBlock({ ...base, replied: true })?.stop).toBe('STOPPED_REPLY');
    expect(campaignSendBlock({ ...base, alreadySentStep: true })).not.toBeNull();
  });
});

describe('campaign email content', () => {
  it('carries identity, postal address, source, unsubscribe link and one-click headers', () => {
    const e = composeCampaignEmail({ body: 'Hello', to: 'jane@fund.com', sourceUrl: 'https://fund.com/team', postalAddress: '1 Main St', company: 'Acme' });
    expect(e.text).toContain('David Mbaimbai, AppWeaver AI, on behalf of Acme');
    expect(e.text).toContain('1 Main St');
    expect(e.text).toContain('https://fund.com/team');
    expect(e.text).toContain('/api/outreach/unsubscribe?');
    expect(e.html).toContain('Opt out');
    expect(e.headers['List-Unsubscribe']).toContain(e.link);
    expect(e.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('sendToTarget guardrails', () => {
  const run = (over: Partial<{ target: unknown }> = {}) =>
    sendToTarget({ campaign, target: (over.target ?? target) as never, ctx, company: 'Acme', postalAddress: '1 Main St', now: TUE_10_UTC });

  it('sends once with unsubscribe headers and records activity', async () => {
    expect(await run()).toBe('sent');
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    expect(m.sendEmail.mock.calls[0][0].headers['List-Unsubscribe']).toBeTruthy();
    expect(m.sendEmail.mock.calls[0][0].text).toContain('1 Main St');
    expect(m.p.hubInvestorActivity.create).toHaveBeenCalled();
  });

  it('checks suppression right before sending and stops the target', async () => {
    m.p.outreachSuppression.findUnique.mockResolvedValue({ email: 'jane@fund.com' });
    expect(await run()).toBe('skipped');
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.p.investorCampaignTarget.update.mock.calls[0][0].data.status).toBe('STOPPED_OPTOUT');
  });

  it('honours the project opt-out and replies', async () => {
    m.p.hubInvestor.findFirst.mockResolvedValue({ ...investor, optedOut: true });
    expect(await run()).toBe('skipped');
    m.p.hubInvestor.findFirst.mockResolvedValue(investor);
    m.p.hubInvestorReply.count.mockResolvedValue(1);
    expect(await run()).toBe('skipped');
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('is idempotent: an existing or concurrently claimed step is never sent again', async () => {
    m.p.investorCampaignSend.findUnique.mockResolvedValue({ id: 's1', status: 'SENT' });
    expect(await run()).toBe('skipped');
    m.p.investorCampaignSend.findUnique.mockResolvedValue(null);
    m.p.investorCampaignSend.create.mockRejectedValue(new Error('P2002'));
    expect(await run()).toBe('skipped');
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('skips targets whose merge fields are empty instead of sending a broken email', async () => {
    m.p.hubInvestor.findFirst.mockResolvedValue({ ...investor, firm: null });
    expect(await run()).toBe('skipped');
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('releases the claim when delivery fails so it can retry', async () => {
    m.sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    expect(await run()).toBe('failed');
    expect(m.p.investorCampaignSend.deleteMany).toHaveBeenCalled();
  });
});

describe('runInvestorCampaigns', () => {
  const row = { ...(campaign as object), status: 'RUNNING' };
  beforeEach(() => {
    m.p.investorCampaign.findMany.mockResolvedValue([row]);
    m.p.investorCampaignSend.count.mockResolvedValue(0);
    m.p.investorCampaignTarget.findMany.mockResolvedValue([target]);
    m.p.investorCampaignTarget.count.mockResolvedValue(1);
    m.p.investorCampaign.findUnique.mockResolvedValue({ status: 'RUNNING' });
    m.p.investorHubProfile.findUnique.mockResolvedValue({ companyName: 'Acme' });
  });

  it('sends nothing outside the window', async () => {
    const r = await runInvestorCampaigns(SAT_10_UTC);
    expect(r.sent).toBe(0);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('respects the daily limit', async () => {
    m.p.investorCampaignSend.count.mockResolvedValue(20);
    const r = await runInvestorCampaigns(TUE_10_UTC);
    expect(r.sent).toBe(0);
    expect(m.p.investorCampaignTarget.findMany).not.toHaveBeenCalled();
  });

  it('auto-pauses on bounce rate and sends nothing', async () => {
    m.p.investorCampaignSend.count.mockImplementation(async ({ where }: { where: { status: unknown } }) => (where.status === 'BOUNCED' ? 2 : 10));
    const r = await runInvestorCampaigns(TUE_10_UTC);
    expect(r.paused).toBe(1);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('stops mid-run the moment the campaign is paused', async () => {
    m.p.investorCampaign.findUnique.mockResolvedValue({ status: 'PAUSED' });
    const r = await runInvestorCampaigns(TUE_10_UTC);
    expect(r.sent).toBe(0);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('is a dry run when email is not configured: nothing claimed or sent', async () => {
    delete process.env.SMTP_HOST;
    const r = await runInvestorCampaigns(TUE_10_UTC);
    expect(r.dryRun).toBe(true);
    expect(r.wouldSend).toBe(1);
    expect(m.p.investorCampaignSend.create).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('sends one due email when everything passes', async () => {
    const r = await runInvestorCampaigns(TUE_10_UTC);
    expect(r.sent).toBe(1);
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
  });
});

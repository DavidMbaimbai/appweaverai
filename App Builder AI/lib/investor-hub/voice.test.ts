import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  p: {
    investorVoiceCall: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    hubInvestor: { findFirst: vi.fn() },
    hubInvestorContact: { findUnique: vi.fn(), updateMany: vi.fn() },
    investorConsent: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    outreachSuppression: { findUnique: vi.fn() },
    investorHubProfile: { findUnique: vi.fn() },
    hubInvestorActivity: { create: vi.fn() },
    investorMeetingRequest: { create: vi.fn() },
  },
  optOutInvestor: vi.fn(),
  logCall: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: m.p }));
vi.mock('@/lib/anthropic', () => ({ getAnthropicClient: () => ({ messages: { create: m.create } }) }));
vi.mock('./comms', () => ({ optOutInvestor: m.optOutInvestor, logCall: m.logCall }));

import { disclosureScript, detectIntent, insideCallingHours, voiceBlockReason } from './voice-rules';
import { handleGather, handleTwiml, startAiCall, verifyVoiceRequest } from './voice';

const ctx = { userId: 'u1', projectId: 'p1' };
const TUE_10_NY = new Date('2026-10-20T14:00:00Z'); // 10:00 New York, 20:00 Berlin... (Berlin 16:00)
const baseGate = {
  configured: true, phone: '+14155550123', timezone: 'America/New_York', hasAiCallConsent: true, optedOut: false,
  suppressed: false, smsOptedOut: false, callsToday: 0, cap: 10, investorCalledRecently: false, now: TUE_10_NY,
};

describe('voice gates', () => {
  it('refuses without recorded consent and without Twilio config', () => {
    expect(voiceBlockReason({ ...baseGate, hasAiCallConsent: false })).toMatch(/consent/i);
    expect(voiceBlockReason({ ...baseGate, configured: false })).toMatch(/not configured/);
    expect(voiceBlockReason(baseGate)).toBeNull();
  });

  it('applies calling hours in the investor time zone on weekdays only', () => {
    expect(insideCallingHours(TUE_10_NY, 'America/New_York')).toBe(true);
    expect(insideCallingHours(TUE_10_NY, 'Asia/Tokyo')).toBe(false); // 23:00
    expect(insideCallingHours(new Date('2026-10-20T16:00:00Z'), 'America/New_York')).toBe(true); // 12:00
    expect(insideCallingHours(new Date('2026-10-20T22:00:00Z'), 'America/New_York')).toBe(false); // 18:00 end-exclusive
    expect(insideCallingHours(new Date('2026-10-24T15:00:00Z'), 'America/New_York')).toBe(false); // Saturday
    expect(insideCallingHours(TUE_10_NY, null)).toBe(false);
    expect(voiceBlockReason({ ...baseGate, timezone: 'Asia/Tokyo' })).toMatch(/calling hours/);
  });

  it('blocks do-not-contact investors, daily cap and repeat calls', () => {
    expect(voiceBlockReason({ ...baseGate, optedOut: true })).toMatch(/do-not-contact/);
    expect(voiceBlockReason({ ...baseGate, smsOptedOut: true })).toMatch(/do-not-contact/);
    expect(voiceBlockReason({ ...baseGate, callsToday: 10 })).toMatch(/cap/);
    expect(voiceBlockReason({ ...baseGate, investorCalledRecently: true })).toMatch(/24 hours/);
  });

  it('detects stop-calling and transfer requests before the model is consulted', () => {
    expect(detectIntent("please don't call me again")).toBe('dnc');
    expect(detectIntent('Can I speak to the founder?')).toBe('transfer');
    expect(detectIntent("it's not a good time")).toBe('not_now');
    expect(detectIntent('tell me about your traction')).toBeNull();
  });
});

describe('startAiCall consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    m.p.hubInvestor.findFirst.mockResolvedValue({ id: 'i1', optedOut: false, emailKey: null });
    m.p.hubInvestorContact.findUnique.mockResolvedValue({ phone: '+14155550123', timezone: 'America/New_York', smsOptedOut: false });
    m.p.investorVoiceCall.count.mockResolvedValue(0);
    m.p.investorHubProfile.findUnique.mockResolvedValue({ companyName: 'Acme', description: 'x' });
  });

  it('refuses with a clear message when no consent is recorded and never dials', async () => {
    m.p.investorConsent.findMany.mockResolvedValue([]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(startAiCall(ctx, 'i1', { confirmed: true }, TUE_10_NY)).rejects.toThrow(/No recorded consent/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.p.investorVoiceCall.create).not.toHaveBeenCalled();
  });

  it('refuses consent given for a different phone number', async () => {
    m.p.investorConsent.findMany.mockResolvedValue([{ type: 'AI_CALL', phone: '+14155559999', revokedAt: null, obtainedAt: new Date('2026-10-01') }]);
    await expect(startAiCall(ctx, 'i1', { confirmed: true }, TUE_10_NY)).rejects.toThrow(/consent/i);
  });

  it('refuses outside calling hours even with consent', async () => {
    m.p.investorConsent.findMany.mockResolvedValue([{ type: 'AI_CALL', phone: '+14155550123', revokedAt: null, obtainedAt: new Date('2026-10-01') }]);
    await expect(startAiCall(ctx, 'i1', { confirmed: true }, new Date('2026-10-20T03:00:00Z'))).rejects.toThrow(/calling hours/);
  });

  it('shows not configured instead of pretending when Twilio is missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    await expect(startAiCall(ctx, 'i1', { confirmed: true }, TUE_10_NY)).rejects.toThrow(/not configured/);
  });
});

describe('TwiML webhooks', () => {
  const call = { id: 'call1', userId: 'u1', projectId: 'p1', investorId: 'i1', status: 'QUEUED', toNumber: '+14155550123', fromNumber: '+15005550006', transferNumber: '+15551110000', recording: false, turns: 0, transcript: [], startedAt: null, outcome: null, createdAt: new Date() };

  beforeEach(() => {
    vi.clearAllMocks();
    m.optOutInvestor.mockResolvedValue(undefined);
    m.p.investorVoiceCall.findUnique.mockResolvedValue(call);
    m.p.investorVoiceCall.update.mockResolvedValue(call);
    m.p.investorVoiceCall.updateMany.mockResolvedValue({ count: 1 });
    m.p.hubInvestor.findFirst.mockResolvedValue({ id: 'i1', optedOut: false, emailKey: null });
    m.p.hubInvestorContact.findUnique.mockResolvedValue({ phone: call.toNumber, timezone: 'America/New_York', smsOptedOut: false });
    m.p.hubInvestorContact.updateMany.mockResolvedValue({ count: 1 });
    m.p.investorConsent.findMany.mockResolvedValue([{ type: 'AI_CALL', phone: call.toNumber, revokedAt: null, obtainedAt: new Date('2026-10-01') }]);
    m.p.investorConsent.updateMany.mockResolvedValue({ count: 1 });
    m.p.investorHubProfile.findUnique.mockResolvedValue({ companyName: 'Acme', description: 'We build apps', website: '', sector: '', stage: '', amountSought: null, currency: 'USD', geography: '', traction: '', useOfFunds: '' });
  });

  it('opens with the AI disclosure and asks if now is a good time', async () => {
    const xml = await handleTwiml('call1', {}, TUE_10_NY);
    expect(xml).toContain('This is an AI assistant calling on behalf of Acme');
    expect(xml).toContain('Is now a good time');
    expect(xml.indexOf('AI assistant')).toBeLessThan(xml.indexOf('good time'));
    expect(xml).toContain('<Gather input="speech"');
    expect(disclosureScript('Acme', true)).toContain('being recorded');
    expect(disclosureScript('Acme', false)).not.toContain('recorded');
  });

  it('hangs up without speaking if the gates fail when answered (hours)', async () => {
    const xml = await handleTwiml('call1', {}, new Date('2026-10-20T03:00:00Z'));
    expect(xml).not.toContain('<Say');
    expect(xml).toContain('<Hangup/>');
  });

  it('writes suppression immediately when the investor says do not call again', async () => {
    const xml = await handleGather('call1', { SpeechResult: "Please don't call me again" }, 0, TUE_10_NY);
    expect(m.optOutInvestor).toHaveBeenCalledTimes(1);
    expect(m.p.hubInvestorContact.updateMany).toHaveBeenCalled();
    expect(m.p.investorConsent.updateMany).toHaveBeenCalled();
    expect(xml).toContain('<Hangup/>');
    expect(m.create).not.toHaveBeenCalled();
  });

  it('transfers to the founder on request using the owner number as caller ID', async () => {
    const xml = await handleGather('call1', { SpeechResult: 'Can I speak to the founder please' }, 0, TUE_10_NY);
    expect(xml).toContain('<Dial callerId="+15005550006"');
    expect(xml).toContain('+15551110000');
  });

  it('answers through the strict prompt and can request a meeting without inventing times', async () => {
    m.create.mockResolvedValue({ content: [{ type: 'text', text: '{"say":"I will pass that to the founder.","action":"meeting","meetingNote":"Prefers Tuesdays"}' }] });
    const xml = await handleGather('call1', { SpeechResult: 'Yes, lets meet next week' }, 0, TUE_10_NY);
    expect(m.create.mock.calls[0][0].system).toContain("I don't have that information");
    expect(m.p.investorMeetingRequest.create).toHaveBeenCalled();
    expect(xml).toContain('I will pass that to the founder.');
  });

  it('ends the call when the turn limit is reached', async () => {
    const turns = Array.from({ length: 12 }, () => ({ role: 'ai', text: 'x' }));
    m.p.investorVoiceCall.findUnique.mockResolvedValue({ ...call, status: 'IN_PROGRESS', startedAt: TUE_10_NY, transcript: turns });
    const xml = await handleGather('call1', { SpeechResult: 'go on' }, 0, TUE_10_NY);
    expect(xml).toContain('<Hangup/>');
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('Twilio signature validation', () => {
  const sign = (url: string, params: Record<string, string>) =>
    createHmac('sha1', 'tok').update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest('base64');
  const req = (sig: string | null, body = 'CallSid=CA1&SpeechResult=hi') =>
    new Request('https://app.test/api/investor-voice/call1/gather?n=1', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sig ? { 'x-twilio-signature': sig } : {}) },
      body,
    });

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    process.env.TWILIO_VOICE_WEBHOOK_BASE = 'https://app.test';
  });

  it('accepts a correctly signed request and rejects missing or forged ones', async () => {
    const good = sign('https://app.test/api/investor-voice/call1/gather?n=1', { CallSid: 'CA1', SpeechResult: 'hi' });
    expect('params' in (await verifyVoiceRequest(req(good)))).toBe(true);
    const missing = await verifyVoiceRequest(req(null));
    expect('error' in missing && missing.error.status).toBe(403);
    const forged = await verifyVoiceRequest(req('AAAA'));
    expect('error' in forged && forged.error.status).toBe(403);
    const tampered = await verifyVoiceRequest(req(good, 'CallSid=CA1&SpeechResult=evil'));
    expect('error' in tampered && tampered.error.status).toBe(403);
  });
});

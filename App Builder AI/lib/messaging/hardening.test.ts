import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  inboxMessage: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  messageStatusEvent: { create: vi.fn() },
  contactConsent: { upsert: vi.fn(), findUnique: vi.fn() },
  messagingSuppression: { upsert: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
  consentProof: { create: vi.fn(), findFirst: vi.fn() },
}));
const adapterSend = vi.hoisted(() => vi.fn());
const creds = vi.hoisted(() => vi.fn());
const availability = vi.hoisted(() => vi.fn());
const marketing = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('./adapters', () => ({ getAdapter: () => ({ send: adapterSend }) }));
vi.mock('./connections', () => ({ getCredentials: creds }));
vi.mock('./availability', () => ({ getAvailability: availability }));
vi.mock('./respond', () => ({ respondToMessage: vi.fn() }));
vi.mock('@/lib/marketing-credits/system', () => ({ withScopeMarketing: marketing }));

const { evaluateAvailability, credentialFingerprint } = await vi.importActual<typeof import('./availability')>('./availability');
import { getOptInProof, recordConsent, recordOptInProof } from './consent';
import { marketingConsentBlockReason } from './gates';
import { applyStatusUpdates } from './ingest';
import { sendOutbound } from './send';

const scope = { type: 'PROJECT', projectId: 'p1' } as const;
const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' });

beforeEach(() => {
  vi.resetAllMocks();
  availability.mockResolvedValue({ status: 'AVAILABLE' });
  marketing.mockImplementation(async (_o: unknown, fn: () => Promise<unknown>) => ({ ok: true, value: await fn(), charged: 1 }));
  db.messagingSuppression.findUnique.mockResolvedValue(null);
  db.consentProof.findFirst.mockResolvedValue(null);
});

describe('delivery status processing', () => {
  const out = { id: 'm1', direction: 'OUTBOUND', deliveryStatus: 'SENT' };

  it('applies a status once; a replayed event id has no second effect', async () => {
    db.inboxMessage.findUnique.mockResolvedValue(out);
    db.messageStatusEvent.create.mockResolvedValueOnce({}).mockRejectedValueOnce(p2002());
    const update = { channel: 'SMS' as const, providerMessageId: 'SM1', status: 'DELIVERED' as const, eventId: 'SM1:delivered' };
    await applyStatusUpdates([update]);
    await applyStatusUpdates([update]);
    expect(db.inboxMessage.update).toHaveBeenCalledTimes(1);
    expect(db.inboxMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deliveryStatus: 'DELIVERED', error: undefined } });
  });

  it('stores FAILED with the provider error code', async () => {
    db.inboxMessage.findUnique.mockResolvedValue(out);
    db.messageStatusEvent.create.mockResolvedValue({});
    await applyStatusUpdates([{ channel: 'SMS', providerMessageId: 'SM1', status: 'FAILED', errorCode: '30003', error: 'Twilio error 30003' }]);
    expect(db.messageStatusEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ errorCode: '30003', status: 'FAILED' }) });
    expect(db.inboxMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deliveryStatus: 'FAILED', error: 'Twilio error 30003' } });
  });

  it('never moves backwards, never lets FAILED override DELIVERED, and QUEUED is audit-only', async () => {
    db.messageStatusEvent.create.mockResolvedValue({});
    db.inboxMessage.findUnique.mockResolvedValue({ ...out, deliveryStatus: 'READ' });
    await applyStatusUpdates([{ channel: 'WHATSAPP', providerMessageId: 'w1', status: 'DELIVERED' }]);
    db.inboxMessage.findUnique.mockResolvedValue({ ...out, deliveryStatus: 'DELIVERED' });
    await applyStatusUpdates([{ channel: 'WHATSAPP', providerMessageId: 'w1', status: 'FAILED', errorCode: '1' }]);
    db.inboxMessage.findUnique.mockResolvedValue({ ...out, deliveryStatus: null });
    await applyStatusUpdates([{ channel: 'SMS', providerMessageId: 'SM9', status: 'QUEUED' }]);
    expect(db.inboxMessage.update).not.toHaveBeenCalled();
    expect(db.messageStatusEvent.create).toHaveBeenCalledTimes(3);
  });

  it('ignores receipts for unknown or inbound messages without recording them', async () => {
    db.inboxMessage.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...out, direction: 'INBOUND' });
    await applyStatusUpdates([
      { channel: 'SMS', providerMessageId: 'x', status: 'SENT' },
      { channel: 'SMS', providerMessageId: 'y', status: 'SENT' },
    ]);
    expect(db.messageStatusEvent.create).not.toHaveBeenCalled();
  });
});

describe('suppression list', () => {
  it('STOP/opt-out adds the contact to the suppression list; opt-in lifts it', async () => {
    await recordConsent(scope, 'SMS', '+49 151', { optOut: true, source: 'inbound_stop', reason: 'UNSUBSCRIBE' });
    expect(db.messagingSuppression.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ contact: '+49151', reason: 'UNSUBSCRIBE' }) }));
    await recordConsent(scope, 'SMS', '+49 151', { optIn: true, source: 'inbound_start' });
    expect(db.messagingSuppression.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('refuses to record an opt-in without proof', async () => {
    const r = await recordOptInProof(scope, 'SMS', '+49151', { source: 'form', proof: '  ', capturedAt: new Date() });
    expect(r.ok).toBe(false);
    expect(db.consentProof.create).not.toHaveBeenCalled();
    expect(db.contactConsent.upsert).not.toHaveBeenCalled();
  });

  it('refuses an opt-in captured before a later opt-out', async () => {
    db.messagingSuppression.findUnique.mockResolvedValue({ createdAt: new Date('2026-02-01') });
    const r = await recordOptInProof(scope, 'SMS', '+49151', { source: 'form', proof: 'ticked box', capturedAt: new Date('2026-01-01') });
    expect(r.ok).toBe(false);
  });

  it('stores proof together with consent', async () => {
    const r = await recordOptInProof(scope, 'WHATSAPP', '+49151', { source: 'lead_form', proof: 'I agree to texts', capturedAt: new Date('2026-01-01') });
    expect(r.ok).toBe(true);
    expect(db.consentProof.create).toHaveBeenCalled();
    expect(db.contactConsent.upsert).toHaveBeenCalled();
    db.consentProof.findFirst.mockResolvedValue({ source: 's', proof: 'p', capturedAt: new Date() });
    expect(await getOptInProof(scope, 'WHATSAPP', '+49151')).toMatchObject({ source: 's' });
  });
});

describe('marketing proof gate', () => {
  it('requires source, proof and a valid timestamp', () => {
    expect(marketingConsentBlockReason(null)).toMatch(/opt-in/i);
    expect(marketingConsentBlockReason({ source: '', proof: 'x', capturedAt: new Date() })).toMatch(/incomplete/);
    expect(marketingConsentBlockReason({ source: 's', proof: 'x', capturedAt: new Date('nope') })).toMatch(/timestamp/);
    expect(marketingConsentBlockReason({ source: 's', proof: 'x', capturedAt: new Date('2026-01-01') })).toBeNull();
  });
});

describe('availability evaluation', () => {
  const c = { accountSid: 'AC', authToken: 't', from: '+1' };
  const now = new Date('2026-03-01T00:00:00Z');
  const ok = { status: 'VERIFIED', fingerprint: credentialFingerprint(c), checkedAt: new Date('2026-02-28T00:00:00Z') };

  it('is UNAVAILABLE without credentials, without a verification, after failure, on changed credentials or when stale', () => {
    expect(evaluateAvailability('SMS', null, null, now).status).toBe('UNAVAILABLE');
    expect(evaluateAvailability('SMS', c, null, now).status).toBe('UNAVAILABLE');
    expect(evaluateAvailability('SMS', c, { ...ok, status: 'FAILED' }, now).status).toBe('UNAVAILABLE');
    expect(evaluateAvailability('SMS', { ...c, authToken: 'new' }, ok, now).status).toBe('UNAVAILABLE');
    expect(evaluateAvailability('SMS', c, { ...ok, checkedAt: new Date('2026-01-01') }, now).status).toBe('UNAVAILABLE');
  });

  it('is AVAILABLE only with matching, recent, successful verification', () => {
    expect(evaluateAvailability('SMS', c, ok, now).status).toBe('AVAILABLE');
    expect(evaluateAvailability('WEBCHAT', null, null, now).status).toBe('AVAILABLE');
  });
});

describe('sendOutbound hardening gates', () => {
  const convo = { id: 'c1', scopeType: 'PROJECT', scopeId: 'p1', channel: 'SMS', contactRef: '+49151', lastInboundAt: new Date() };
  beforeEach(() => {
    db.conversation.findUnique.mockResolvedValue(convo);
    creds.mockResolvedValue({ accountSid: 'AC', authToken: 't', from: '+1' });
    db.contactConsent.findUnique.mockResolvedValue({ optIn: true, optOut: false });
  });

  it('returns an explicit UNAVAILABLE error and never calls the provider', async () => {
    availability.mockResolvedValue({ status: 'UNAVAILABLE', reason: 'SMS has not been verified yet.' });
    const r = await sendOutbound({ conversationId: 'c1', body: 'Hi' });
    expect(r).toMatchObject({ ok: false, blocked: true });
    expect((r as { error: string }).error).toContain('UNAVAILABLE');
    expect(adapterSend).not.toHaveBeenCalled();
  });

  it('refuses a suppressed contact even if an opt-in row exists', async () => {
    db.messagingSuppression.findUnique.mockResolvedValue({ reason: 'STOP' });
    const r = await sendOutbound({ conversationId: 'c1', body: 'Hi' });
    expect(r).toMatchObject({ ok: false, blocked: true });
    expect((r as { error: string }).error).toContain('suppression');
    expect(adapterSend).not.toHaveBeenCalled();
  });

  it('refuses lead/marketing messages without opt-in proof but allows plain replies', async () => {
    adapterSend.mockResolvedValue({ providerMessageId: 'SM1' });
    db.inboxMessage.create.mockResolvedValue({ id: 'm1' });
    const lead = await sendOutbound({ conversationId: 'c1', body: 'Offer', purpose: 'lead' });
    expect(lead).toMatchObject({ ok: false, blocked: true });
    expect(adapterSend).not.toHaveBeenCalled();

    const reply = await sendOutbound({ conversationId: 'c1', body: 'Thanks for writing' });
    expect(reply).toMatchObject({ ok: true });
    expect(adapterSend).toHaveBeenCalledTimes(1);

    db.consentProof.findFirst.mockResolvedValue({ source: 'form', proof: 'ticked', capturedAt: new Date('2026-01-01') });
    const withProof = await sendOutbound({ conversationId: 'c1', body: 'Offer', purpose: 'marketing' });
    expect(withProof).toMatchObject({ ok: true });
  });

  it('blocks the send when marketing credits are insufficient', async () => {
    marketing.mockResolvedValue({ ok: false, reason: 'insufficient', insufficient: true, error: 'Need 1 credit.' });
    const r = await sendOutbound({ conversationId: 'c1', body: 'Hi' });
    expect(r).toMatchObject({ ok: false, blocked: true });
    expect((r as { error: string }).error).toContain('insufficient credits');
    expect(adapterSend).not.toHaveBeenCalled();
  });
});

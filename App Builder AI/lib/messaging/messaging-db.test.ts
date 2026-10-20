import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  inboxMessage: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  platformKnowledge: { findMany: vi.fn() },
  projectKnowledge: { findMany: vi.fn() },
  contactConsent: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
const adapterSend = vi.hoisted(() => vi.fn());
const consent = vi.hoisted(() => ({
  getConsent: vi.fn(),
  recordConsent: vi.fn(),
  getSuppression: vi.fn().mockResolvedValue(null),
  getOptInProof: vi.fn().mockResolvedValue(null),
}));
const creds = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('./availability', () => ({ getAvailability: async () => ({ status: 'AVAILABLE' }) }));
vi.mock('@/lib/marketing-credits/system', () => ({
  withScopeMarketing: async (_o: unknown, fn: () => Promise<unknown>) => ({ ok: true, value: await fn(), charged: 0 }),
}));
vi.mock('./consent', () => consent);
vi.mock('./connections', () => ({ getCredentials: creds }));
vi.mock('./adapters', () => ({ getAdapter: () => ({ send: adapterSend }) }));
vi.mock('./respond', () => ({ respondToMessage: vi.fn() }));

import { ingestInbound } from './ingest';
import { loadKnowledge } from './knowledge';
import { sendOutbound } from './send';

beforeEach(() => {
  vi.clearAllMocks();
});

const convo = { id: 'c1', scopeType: 'PROJECT', scopeId: 'p1', channel: 'WHATSAPP', contactRef: '+49151', contactName: null, lastInboundAt: null, humanTakeover: false, status: 'OPEN' };

describe('idempotent inbound', () => {
  const msg = { channel: 'WHATSAPP' as const, providerMessageId: 'wamid.1', externalThreadId: '49151', contactRef: '+49151', body: 'Hello' };

  it('stores a message once and treats a retried webhook as a duplicate', async () => {
    db.conversation.findFirst.mockResolvedValue(convo);
    db.inboxMessage.create.mockResolvedValueOnce({ id: 'm1' }).mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

    const first = await ingestInbound({ type: 'PROJECT', projectId: 'p1' }, msg);
    const retry = await ingestInbound({ type: 'PROJECT', projectId: 'p1' }, msg);

    expect(first).toMatchObject({ duplicate: false, messageId: 'm1' });
    expect(retry).toEqual({ duplicate: true });
    expect(db.conversation.update).toHaveBeenCalledTimes(1);
  });

  it('records an opt-out when the contact texts STOP', async () => {
    db.conversation.findFirst.mockResolvedValue({ ...convo, channel: 'SMS' });
    db.inboxMessage.create.mockResolvedValue({ id: 'm2' });
    const result = await ingestInbound({ type: 'PROJECT', projectId: 'p1' }, { ...msg, channel: 'SMS', providerMessageId: 'SM1', body: 'STOP' });
    expect(result).toMatchObject({ duplicate: false, optOut: true });
    expect(consent.recordConsent).toHaveBeenCalledWith({ type: 'PROJECT', projectId: 'p1' }, 'SMS', '+49151', expect.objectContaining({ optOut: true }));
  });
});

describe('outbound honours opt-out and the window', () => {
  beforeEach(() => {
    creds.mockResolvedValue({ accessToken: 't', phoneNumberId: 'PN', approvedTemplates: [] });
  });

  it('does not call the provider for an opted-out contact', async () => {
    db.conversation.findUnique.mockResolvedValue({ ...convo, lastInboundAt: new Date() });
    consent.getConsent.mockResolvedValue({ optIn: true, optOut: true });
    const result = await sendOutbound({ conversationId: 'c1', body: 'Hi', aiGenerated: true });
    expect(result).toMatchObject({ ok: false, blocked: true });
    expect(adapterSend).not.toHaveBeenCalled();
  });

  it('refuses free-form WhatsApp text outside the 24h window', async () => {
    db.conversation.findUnique.mockResolvedValue({ ...convo, lastInboundAt: new Date(Date.now() - 30 * 3_600_000) });
    consent.getConsent.mockResolvedValue({ optIn: true, optOut: false });
    const result = await sendOutbound({ conversationId: 'c1', body: 'Hi' });
    expect(result).toMatchObject({ ok: false, blocked: true });
    expect(adapterSend).not.toHaveBeenCalled();
  });

  it('refuses a conversation that belongs to another scope', async () => {
    db.conversation.findUnique.mockResolvedValue(convo);
    const result = await sendOutbound({ conversationId: 'c1', body: 'Hi', scope: { type: 'PROJECT', projectId: 'other' } });
    expect(result).toMatchObject({ ok: false, blocked: true });
    expect(adapterSend).not.toHaveBeenCalled();
  });
});

describe('no cross-scope knowledge leakage', () => {
  it('platform scope reads only platform knowledge', async () => {
    db.platformKnowledge.findMany.mockResolvedValue([{ id: 'k1', title: 'AppWeaver', content: 'x' }]);
    const docs = await loadKnowledge({ type: 'PLATFORM' });
    expect(docs.map((d) => d.id)).toEqual(['k1']);
    expect(db.projectKnowledge.findMany).not.toHaveBeenCalled();
  });

  it('a project reads only its own knowledge and never platform knowledge', async () => {
    db.projectKnowledge.findMany.mockResolvedValue([{ id: 'k2', title: 'Hours', content: 'y' }]);
    await loadKnowledge({ type: 'PROJECT', projectId: 'p1' });
    expect(db.projectKnowledge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'p1' } }));
    expect(db.platformKnowledge.findMany).not.toHaveBeenCalled();
  });
});

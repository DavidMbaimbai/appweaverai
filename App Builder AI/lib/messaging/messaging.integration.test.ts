import { describe, expect, it } from 'vitest';

import { prisma } from '@/tests/integration/db';

import { applyStatusUpdates, ingestInbound } from './ingest';

const scope = { type: 'PLATFORM' } as const;

const inbound = (providerMessageId: string, extra: Record<string, unknown> = {}) => ({
  channel: 'WHATSAPP' as const,
  providerMessageId,
  externalThreadId: '+15551230001',
  contactRef: '+15551230001',
  body: 'Hello there',
  ...extra,
});

describe('messaging webhooks (real Postgres)', () => {
  it('stores a replayed provider message once', async () => {
    const first = await ingestInbound(scope, inbound('wamid.1'));
    const replay = await ingestInbound(scope, inbound('wamid.1'));
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ duplicate: true });
    expect(await prisma.inboxMessage.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('keeps one conversation and one message when the same webhook races', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => ingestInbound(scope, inbound('wamid.race'))));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await prisma.inboxMessage.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('puts different messages from one contact in the same conversation', async () => {
    await Promise.all([ingestInbound(scope, inbound('wamid.a')), ingestInbound(scope, inbound('wamid.b'))]);
    expect(await prisma.inboxMessage.count()).toBe(2);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('applies delivery receipts once, only moving forward', async () => {
    const seeded = await ingestInbound(scope, inbound('wamid.in'));
    if (seeded.duplicate) throw new Error('unexpected duplicate');
    await prisma.inboxMessage.create({
      data: {
        conversationId: seeded.conversationId,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        body: 'Reply',
        providerMessageId: 'wamid.out',
        deliveryStatus: 'SENT',
      },
    });
    const update = (status: 'DELIVERED' | 'READ' | 'FAILED', eventId: string) => ({
      channel: 'WHATSAPP' as const,
      providerMessageId: 'wamid.out',
      status,
      eventId,
    });
    await Promise.all([
      applyStatusUpdates([update('DELIVERED', 'ev1')]),
      applyStatusUpdates([update('DELIVERED', 'ev1')]),
    ]);
    await applyStatusUpdates([update('READ', 'ev2'), update('DELIVERED', 'ev3'), update('FAILED', 'ev4')]);
    await applyStatusUpdates([update('READ', 'ev2')]);

    const message = await prisma.inboxMessage.findUnique({
      where: { channel_providerMessageId: { channel: 'WHATSAPP', providerMessageId: 'wamid.out' } },
    });
    expect(message?.deliveryStatus).toBe('READ');
    expect(await prisma.messageStatusEvent.count({ where: { eventId: 'ev1' } })).toBe(1);
    expect(await prisma.messageStatusEvent.count()).toBe(4);
  });
});

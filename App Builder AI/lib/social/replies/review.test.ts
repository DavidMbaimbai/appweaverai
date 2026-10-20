import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  socialInteraction: {
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
}));
const sendSocialReply = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn() }));
vi.mock('@/lib/social/replies/send', () => ({ sendSocialReply, googleAccessToken: vi.fn() }));

import { reviewInteraction } from '@/lib/social/replies/process';
import { parseMetaWebhook, verifyMetaSignature } from '@/lib/social/replies/sources';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.socialInteraction.updateMany.mockResolvedValue({ count: 1 });
  prisma.socialInteraction.findUniqueOrThrow.mockResolvedValue({
    id: 'i1',
    platform: 'X',
    externalId: '99',
    replyToId: null,
    authorHandle: 'vc',
    reply: 'Thanks, David will follow up.',
    note: null,
    attempts: 0,
  });
});

describe('reviewInteraction', () => {
  it('sends the edited reply once and records SENT', async () => {
    sendSocialReply.mockResolvedValue({ ok: true, id: 't1' });
    expect(await reviewInteraction('i1', { action: 'approve', reply: 'Edited' })).toEqual({ ok: true });
    expect(sendSocialReply).toHaveBeenCalledWith(expect.objectContaining({ text: 'Edited', externalId: '99' }));
    expect(prisma.socialInteraction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('marks FAILED (retryable) when the platform rejects it', async () => {
    sendSocialReply.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await reviewInteraction('i1', { action: 'approve' })).toEqual({ ok: false, error: 'send-failed' });
    expect(prisma.socialInteraction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('refuses a second approval of the same item', async () => {
    prisma.socialInteraction.updateMany.mockResolvedValue({ count: 0 });
    expect(await reviewInteraction('i1', { action: 'approve' })).toEqual({ ok: false, error: 'not-reviewable' });
    expect(sendSocialReply).not.toHaveBeenCalled();
  });
});

describe('Meta webhook', () => {
  it('verifies the signature', () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac('sha256', 's').update(body).digest('hex')}`;
    expect(verifyMetaSignature(body, sig, 's')).toBe(true);
    expect(verifyMetaSignature(body, sig, 'other')).toBe(false);
    expect(verifyMetaSignature(body, null, 's')).toBe(false);
  });

  it('extracts customer comments and ignores our own page', () => {
    const payload = {
      object: 'page',
      entry: [
        {
          changes: [
            { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', message: 'Hi', from: { id: 'u1', name: 'Jo' } } },
            { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c2', message: 'Self', from: { id: 'PAGE' } } },
            { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c3', message: 'x', from: { id: 'u2' } } },
          ],
        },
      ],
    };
    const out = parseMetaWebhook(payload, { pageId: 'PAGE' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ platform: 'FACEBOOK', externalId: 'c1', authorHandle: 'u1' });
  });
});

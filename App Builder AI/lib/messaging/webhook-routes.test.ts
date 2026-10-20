import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const batch = vi.hoisted(() => vi.fn());
const afterQueue = vi.hoisted(() => [] as Array<() => unknown>);
const conn = vi.hoisted(() => ({ resolveScopeForAccount: vi.fn(), getCredentials: vi.fn() }));
const interaction = vi.hoisted(() => vi.fn());

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => {
    afterQueue.push(fn);
  },
}));
vi.mock('@/lib/messaging/webhooks', () => ({ processInboundBatch: batch }));
vi.mock('@/lib/messaging/connections', () => conn);
vi.mock('@/lib/social/replies/process', () => ({ ingestInteraction: interaction }));

import { GET as metaGet, POST as metaPost } from '@/app/api/webhooks/meta/route';
import { GET as waGet, POST as waPost } from '@/app/api/webhooks/whatsapp/route';
import { POST as smsPost } from '@/app/api/webhooks/sms/route';

const SECRET = 'app-secret';
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const twilioSig = (token: string, url: string, params: Record<string, string>) =>
  createHmac('sha1', token)
    .update(url + Object.keys(params).sort().map((k) => k + params[k]).join(''))
    .digest('base64');

async function flush() {
  while (afterQueue.length) await afterQueue.shift()!();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterQueue.length = 0;
  process.env.META_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'wa-verify';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'meta-verify';
  process.env.TWILIO_INBOX_WEBHOOK_URL = 'https://app.example/api/webhooks/sms';
});

const waPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'PN1' },
            contacts: [{ wa_id: '4915100', profile: { name: 'Ann' } }],
            messages: [{ id: 'wamid.IN1', from: '4915100', timestamp: '1700000000', type: 'text', text: { body: 'Hi' } }],
            statuses: [{ id: 'wamid.OUT1', status: 'failed', timestamp: '1700000050', errors: [{ code: 131047, message: 'Re-engagement message' }] }],
          },
        },
      ],
    },
  ],
};

describe('WhatsApp webhook route', () => {
  const url = (q: string) => new Request(`https://app.example/api/webhooks/whatsapp?${q}`);

  it('answers the verify handshake only with the right token', async () => {
    const ok = await waGet(url('hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=abc'));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('abc');
    expect((await waGet(url('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc'))).status).toBe(403);
    expect((await waGet(url('hub.mode=subscribe&hub.verify_token=wa-verifyX&hub.challenge=abc'))).status).toBe(403);
  });

  it('rejects a missing or wrong X-Hub-Signature-256 and processes nothing', async () => {
    const raw = JSON.stringify(waPayload);
    const bad = await waPost(new Request('https://app.example/api/webhooks/whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign(raw, 'wrong') } }));
    const none = await waPost(new Request('https://app.example/api/webhooks/whatsapp', { method: 'POST', body: raw }));
    expect(bad.status).toBe(401);
    expect(none.status).toBe(401);
    await flush();
    expect(batch).not.toHaveBeenCalled();
  });

  it('accepts a signed payload and forwards inbound messages plus status with error code', async () => {
    const raw = JSON.stringify(waPayload);
    const res = await waPost(new Request('https://app.example/api/webhooks/whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign(raw) } }));
    expect(res.status).toBe(200);
    await flush();
    const [messages, statuses] = batch.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ channel: 'WHATSAPP', providerMessageId: 'wamid.IN1', accountId: 'PN1' });
    expect(statuses[0]).toMatchObject({ providerMessageId: 'wamid.OUT1', status: 'FAILED', errorCode: '131047', eventId: 'wamid.OUT1:failed' });
  });
});

describe('SMS (Twilio) webhook route', () => {
  const URL_ = 'https://app.example/api/webhooks/sms';
  const form = (params: Record<string, string>, signature: string | null) =>
    new Request(URL_, {
      method: 'POST',
      body: new URLSearchParams(params),
      headers: signature ? { 'x-twilio-signature': signature } : {},
    });

  beforeEach(() => {
    conn.resolveScopeForAccount.mockResolvedValue({ type: 'PLATFORM' });
    conn.getCredentials.mockResolvedValue({ accountSid: 'AC1', authToken: 'tok', from: '+4930' });
  });

  it('rejects an invalid or missing X-Twilio-Signature with 403', async () => {
    const params = { MessageSid: 'SM1', From: '+4915', To: '+4930', Body: 'Hi' };
    expect((await smsPost(form(params, 'bogus'))).status).toBe(403);
    expect((await smsPost(form(params, null))).status).toBe(403);
    await flush();
    expect(batch).not.toHaveBeenCalled();
  });

  it('rejects unknown destination accounts', async () => {
    conn.resolveScopeForAccount.mockResolvedValue(null);
    const params = { MessageSid: 'SM1', From: '+4915', To: '+9999', Body: 'Hi' };
    expect((await smsPost(form(params, twilioSig('tok', URL_, params)))).status).toBe(403);
  });

  it('accepts a valid inbound (including STOP) and passes it on', async () => {
    const params = { MessageSid: 'SM2', From: '+4915', To: '+4930', Body: 'STOP' };
    const res = await smsPost(form(params, twilioSig('tok', URL_, params)));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<Response/>');
    await flush();
    expect(batch.mock.calls[0][0][0]).toMatchObject({ channel: 'SMS', providerMessageId: 'SM2', body: 'STOP' });
  });

  it('accepts a signed status callback and resolves the scope via From (our number)', async () => {
    const params = { MessageSid: 'SM3', MessageStatus: 'undelivered', ErrorCode: '30003', From: '+4930', To: '+4915' };
    const res = await smsPost(form(params, twilioSig('tok', URL_, params)));
    expect(res.status).toBe(200);
    expect(conn.resolveScopeForAccount).toHaveBeenCalledWith('SMS', '+4930');
    await flush();
    const [messages, statuses] = batch.mock.calls[0];
    expect(messages).toEqual([]);
    expect(statuses[0]).toMatchObject({ providerMessageId: 'SM3', status: 'FAILED', errorCode: '30003', eventId: 'SM3:undelivered' });
  });
});

describe('Meta (Messenger/Instagram) webhook route', () => {
  const dm = {
    object: 'page',
    entry: [
      {
        id: 'PAGE1',
        messaging: [
          { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, timestamp: 1700000000000, message: { mid: 'm.1', text: 'Hello' } },
          { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, timestamp: 1700000001000, delivery: { mids: ['m.0'] } },
        ],
      },
    ],
  };

  it('verifies the subscription token', async () => {
    const ok = await metaGet(new Request('https://app.example/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=meta-verify&hub.challenge=zz'));
    expect(await ok.text()).toBe('zz');
    expect((await metaGet(new Request('https://app.example/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=zz'))).status).toBe(403);
  });

  it('rejects bad signatures and accepts signed DMs with delivery receipts', async () => {
    const raw = JSON.stringify(dm);
    const bad = await metaPost(new Request('https://app.example/api/webhooks/meta', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign(raw, 'wrong') } }));
    expect(bad.status).toBe(401);
    expect(batch).not.toHaveBeenCalled();

    const good = await metaPost(new Request('https://app.example/api/webhooks/meta', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign(raw) } }));
    expect(good.status).toBe(200);
    await flush();
    const [messages, statuses] = batch.mock.calls[0];
    expect(messages[0]).toMatchObject({ providerMessageId: 'm.1' });
    expect(statuses[0]).toMatchObject({ providerMessageId: 'm.0', status: 'DELIVERED', eventId: 'm.0:delivered' });
  });
});

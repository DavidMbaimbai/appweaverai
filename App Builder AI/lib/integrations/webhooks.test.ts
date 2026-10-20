import { describe, expect, it } from 'vitest';

import { tokenMatches } from './proxy';
import { toConnectionView } from './service';
import { backoffSeconds, MAX_DELIVERY_ATTEMPTS, signatureHeader, verifyWebhookSignature } from './webhooks';

const secret = 'whsec_test';
const body = '{"hello":"world"}';
const now = 1_800_000_000;

describe('webhook signatures', () => {
  const verify = (over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
    verifyWebhookSignature({ secret, timestamp: String(now), signature: signatureHeader(secret, now, body), body, nowSeconds: now, ...over });

  it('accepts a valid signature', () => expect(verify()).toEqual({ ok: true }));
  it('rejects a tampered body', () => expect(verify({ body: '{"hello":"evil"}' })).toEqual({ ok: false, reason: 'bad_signature' }));
  it('rejects a wrong secret', () => expect(verify({ secret: 'other' })).toEqual({ ok: false, reason: 'bad_signature' }));
  it('rejects a swapped timestamp', () => {
    const sig = signatureHeader(secret, now, body);
    expect(verify({ timestamp: String(now + 1), signature: sig })).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects replays outside the tolerance window', () => {
    const old = now - 301;
    expect(verify({ timestamp: String(old), signature: signatureHeader(secret, old, body) })).toEqual({ ok: false, reason: 'stale' });
    const fresh = now - 299;
    expect(verify({ timestamp: String(fresh), signature: signatureHeader(secret, fresh, body) }).ok).toBe(true);
  });
  it('rejects missing and malformed headers', () => {
    expect(verify({ signature: null })).toEqual({ ok: false, reason: 'missing' });
    expect(verify({ timestamp: 'abc' })).toEqual({ ok: false, reason: 'missing' });
    expect(verify({ signature: 'v1=zz' }).ok).toBe(false);
  });
});

describe('backoffSeconds', () => {
  it('grows and stops after the maximum attempts', () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(300);
    expect(backoffSeconds(MAX_DELIVERY_ATTEMPTS - 1)).toBe(43_200);
    expect(backoffSeconds(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });
});

describe('proxy token comparison', () => {
  it('matches only the exact token', () => {
    expect(tokenMatches('awp_abc', 'awp_abc')).toBe(true);
    expect(tokenMatches('awp_abc', 'awp_abd')).toBe(false);
    expect(tokenMatches(null, 'awp_abc')).toBe(false);
  });
});

describe('connection view never serialises secrets', () => {
  it('omits secretEnc and secret values', () => {
    const row = {
      id: 'c1',
      projectId: 'p1',
      integrationId: 'stripe',
      status: 'CONNECTED',
      healthStatus: 'HEALTHY',
      config: {},
      maskedHints: { secretKey: '••••l123' },
      secretEnc: 'ENCRYPTED-BLOB-sk_test_PLAINTEXTSECRET',
      lastTestAt: new Date(),
      lastTestOk: true,
      lastTestLatencyMs: 12,
      lastTestError: null,
      lastUsedAt: null,
      usageCount: 0,
      createdAt: new Date(),
    } as unknown as Parameters<typeof toConnectionView>[0];
    const text = JSON.stringify(toConnectionView(row));
    expect(text).not.toContain('PLAINTEXTSECRET');
    expect(text).not.toContain('secretEnc');
    expect(text).toContain('••••l123');
    expect(text).toContain('STRIPE_SECRET_KEY');
  });
});

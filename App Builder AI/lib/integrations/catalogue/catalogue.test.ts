import { describe, expect, it, vi } from 'vitest';

import { clientExposedPrefix, publicSecretWarning } from '../safety';
import { getIntegration, INTEGRATIONS, maskLast4, toPublicIntegration, validateCatalogue, validateCredentials } from './index';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ctxWith = (impl: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const mock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => impl(String(url), init));
  const fetch = mock as unknown as typeof globalThis.fetch;
  return { ctx: { fetch, safeFetch: fetch }, fetch: mock };
};

describe('catalogue', () => {
  it('passes its own validation', () => {
    expect(validateCatalogue()).toEqual([]);
  });

  it('only marks integrations available when they can be tested, and labels the rest coming soon', () => {
    for (const def of INTEGRATIONS) {
      if (def.status === 'available' && !def.platformFeature) expect(def.test, def.id).toBeTypeOf('function');
      if (def.status === 'coming_soon') expect(def.test, def.id).toBeUndefined();
    }
    expect(INTEGRATIONS.some((d) => d.status === 'coming_soon')).toBe(true);
  });

  it('never exposes credentials through browser-exposed env var prefixes', () => {
    for (const def of INTEGRATIONS) {
      for (const field of def.fields) if (field.envVar) expect(clientExposedPrefix(field.envVar), field.envVar).toBeNull();
    }
    expect(publicSecretWarning('NEXT_PUBLIC_STRIPE_SECRET_KEY')).toContain('browser');
    expect(publicSecretWarning('STRIPE_SECRET_KEY')).toBeNull();
  });

  it('does not ship validators or tests to the client view', () => {
    const view = toPublicIntegration(getIntegration('stripe')!) as Record<string, unknown>;
    expect(view.test).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"pattern"');
  });

  it('validates credential formats and masks to last 4', () => {
    const stripe = getIntegration('stripe')!;
    expect(validateCredentials(stripe, { secretKey: 'pk_live_abcdefghijkl' }).ok).toBe(false);
    expect(validateCredentials(stripe, {}).ok).toBe(false);
    expect(validateCredentials(stripe, { secretKey: 'sk_test_abcdefghijkl' }).ok).toBe(true);
    expect(maskLast4('sk_test_abcdefghijkl')).toBe('••••ijkl');
    expect(maskLast4('abc')).toBe('••••');
  });
});

describe('test-connection with mocked fetch', () => {
  it('Stripe succeeds on 200 and fails on 401 without echoing the key', async () => {
    const stripe = getIntegration('stripe')!;
    const key = 'sk_test_supersecretvalue1';
    const ok = ctxWith(() => json({ object: 'balance' }));
    const good = await stripe.test!({ secretKey: key }, ok.ctx);
    expect(good.ok).toBe(true);
    expect(String(ok.fetch.mock.calls[0][0])).toBe('https://api.stripe.com/v1/balance');
    expect((ok.fetch.mock.calls[0][1]?.method ?? 'GET').toUpperCase()).toBe('GET');

    const bad = await stripe.test!({ secretKey: key }, ctxWith(() => json({}, 401)).ctx);
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain(key);
  });

  it('reports network failures as failures', async () => {
    const result = await getIntegration('openai')!.test!({ apiKey: 'sk-aaaaaaaaaaaaaaaaaaaaaaaa' }, ctxWith(() => {
      throw new Error('boom');
    }).ctx);
    expect(result.ok).toBe(false);
  });

  it('Slack requires ok:true in the body even on HTTP 200', async () => {
    const slack = getIntegration('slack')!;
    const token = 'xoxb-1234567890-abcdefghij';
    expect((await slack.test!({ botToken: token }, ctxWith(() => json({ ok: true })).ctx)).ok).toBe(true);
    expect((await slack.test!({ botToken: token }, ctxWith(() => json({ ok: false, error: 'invalid_auth' })).ctx)).ok).toBe(false);
  });
});

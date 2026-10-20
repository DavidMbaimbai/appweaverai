import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

import { makeUser, prisma, uid } from '@/tests/integration/db';

vi.mock('@/lib/marketing-credits/purchase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/marketing-credits/purchase')>(
    '@/lib/marketing-credits/purchase',
  );
  return { ...actual, grantPurchase: vi.fn(actual.grantPurchase) };
});
vi.mock('@/lib/billing/receipts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/receipts')>('@/lib/billing/receipts');
  return { ...actual, sendPaymentReceiptEmail: vi.fn(), sendSubscriptionConfirmationEmail: vi.fn() };
});

import { grantPurchase } from '@/lib/marketing-credits/purchase';

import { POST } from './route';

const stripe = new Stripe('sk_test_integration');

function signedRequest(event: object, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: payload,
  });
}

function purchaseEvent(userId: string, eventId = `evt_${uid('e')}`, sessionId = `cs_${uid('s')}`) {
  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_status: 'paid',
        payment_intent: `pi_${uid('p')}`,
        amount_total: 2000,
        currency: 'usd',
        metadata: { kind: 'marketing_credits', userId, credits: '100', packageName: 'Starter' },
      },
    },
  };
}

async function balance(userId: string) {
  const wallet = await prisma.marketingWallet.findUnique({ where: { userId } });
  return wallet?.available ?? 0;
}

describe('Stripe webhook (real Postgres)', () => {
  it('rejects unsigned and wrongly signed requests without recording anything', async () => {
    const user = await makeUser();
    const event = purchaseEvent(user.id);
    const unsigned = await POST(
      new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(event) }),
    );
    expect(unsigned.status).toBe(400);
    const forged = await POST(signedRequest(event, 'whsec_wrong'));
    expect(forged.status).toBe(400);
    expect(await prisma.stripeEvent.count()).toBe(0);
    expect(await balance(user.id)).toBe(0);
  });

  it('grants a purchase once when the same event id is delivered twice', async () => {
    const user = await makeUser();
    const event = purchaseEvent(user.id);
    const first = await POST(signedRequest(event));
    const second = await POST(signedRequest(event));
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(await balance(user.id)).toBe(100);
    expect(await prisma.stripeEvent.count()).toBe(1);
  });

  it('grants once when the same event is delivered concurrently', async () => {
    const user = await makeUser();
    const event = purchaseEvent(user.id);
    const responses = await Promise.all(Array.from({ length: 6 }, () => POST(signedRequest(event))));
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await balance(user.id)).toBe(100);
  });

  it('does not double-grant a checkout session redelivered under a new event id', async () => {
    const user = await makeUser();
    const sessionId = `cs_${uid('s')}`;
    await POST(signedRequest(purchaseEvent(user.id, 'evt_a', sessionId)));
    await POST(signedRequest(purchaseEvent(user.id, 'evt_b', sessionId)));
    expect(await balance(user.id)).toBe(100);
  });

  it('lets Stripe retry after a handler failure instead of dropping credits', async () => {
    const user = await makeUser();
    const event = purchaseEvent(user.id);
    vi.mocked(grantPurchase).mockRejectedValueOnce(new Error('transient db failure'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await POST(signedRequest(event));
    quiet.mockRestore();
    expect(failed.status).toBe(500);
    expect(await balance(user.id)).toBe(0);

    const retry = await POST(signedRequest(event));
    expect(retry.status).toBe(200);
    expect(await retry.json()).not.toHaveProperty('duplicate');
    expect(await balance(user.id)).toBe(100);
  });
});

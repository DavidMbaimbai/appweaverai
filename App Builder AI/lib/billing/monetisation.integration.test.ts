import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma, sql, uid } from '@/tests/integration/db';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined), BRAND_LOGO_CID: 'logo' }));
vi.mock('@/lib/billing/receipts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/receipts')>('@/lib/billing/receipts');
  return { ...actual, sendPaymentReceiptEmail: vi.fn(), sendSubscriptionConfirmationEmail: vi.fn() };
});

import { POST } from '@/app/api/webhooks/stripe/route';
import { loadCustomerInvoices } from '@/lib/billing/invoices';
import { chargeCredits } from '@/lib/credits/ledger';
import { checkSpendLimits, evaluateUsageAlerts, setSpendLimit } from '@/lib/credits/limits';
import { reverseDevEntry, reverseMarketingEntry } from '@/lib/credits/reversal';
import { loadUnifiedLedger } from '@/lib/credits/unified-ledger';
import { sendEmail } from '@/lib/email';
import { grantCredits } from '@/lib/marketing-credits/wallet';

const stripe = new Stripe('sk_test_integration');
let clock = Math.floor(Date.now() / 1000) - 1000;
const tick = () => (clock += 10);

function signed(event: object) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return new Request('http://localhost/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload });
}

const event = (type: string, object: object, id = `evt_${uid('e')}`, created = tick()) => ({ id, object: 'event', type, created, data: { object } });

function subscription(id: string, customer: string, userId: string, unit: number, status = 'active') {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    metadata: { userId, planId: 'pro' },
    start_date: clock - 5000,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          quantity: 1,
          current_period_end: clock + 86_400 * 20,
          price: { id: 'price_x', currency: 'usd', unit_amount: unit, recurring: { interval: 'month', interval_count: 1 } },
        },
      ],
    },
  };
}

function invoice(id: string, customer: string, status: string, extra: object = {}) {
  return {
    id,
    object: 'invoice',
    customer,
    number: `INV-${id}`,
    status,
    currency: 'usd',
    amount_due: 2000,
    amount_paid: status === 'paid' ? 2000 : 0,
    amount_remaining: status === 'paid' ? 0 : 2000,
    hosted_invoice_url: `https://invoice.stripe.com/${id}`,
    invoice_pdf: `https://invoice.stripe.com/${id}/pdf`,
    created: clock,
    period_start: clock - 100,
    period_end: clock + 100,
    attempt_count: 1,
    lines: { data: [] },
    status_transitions: { paid_at: status === 'paid' ? clock : null },
    ...extra,
  };
}

async function userWithCustomer() {
  const user = await makeUser({ plan: 'pro' });
  const customer = `cus_${uid('c')}`;
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer, creditBalance: 1000 } });
  return { user, customer };
}

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

describe('Stripe billing sync webhooks', () => {
  it('records a subscription and MRR change once, even when an event is redelivered', async () => {
    const { user, customer } = await userWithCustomer();
    const subId = `sub_${uid('s')}`;
    const created = event('customer.subscription.created', subscription(subId, customer, user.id, 2000));
    const updated = event('customer.subscription.updated', subscription(subId, customer, user.id, 4000));

    expect((await POST(signed(created))).status).toBe(200);
    expect((await POST(signed(updated))).status).toBe(200);
    expect(await (await POST(signed(updated))).json()).toMatchObject({ duplicate: true });

    const row = await prisma.stripeSubscription.findUniqueOrThrow({ where: { id: subId } });
    expect(row.mrrCents).toBe(4000);
    const changes = await prisma.stripeSubscriptionMrrChange.findMany({ where: { subscriptionId: subId }, orderBy: { effectiveAt: 'asc' } });
    expect(changes.map((c) => c.mrrCents)).toEqual([2000, 4000]);
  });

  it('does not let an older event overwrite newer subscription state', async () => {
    const { user, customer } = await userWithCustomer();
    const subId = `sub_${uid('s')}`;
    const newer = event('customer.subscription.updated', subscription(subId, customer, user.id, 5000), undefined, tick() + 500);
    const older = event('customer.subscription.updated', subscription(subId, customer, user.id, 1000), undefined, tick());
    await POST(signed(newer));
    await POST(signed(older));
    expect((await prisma.stripeSubscription.findUniqueOrThrow({ where: { id: subId } })).mrrCents).toBe(5000);
  });

  it('shows the dunning state on payment failure and clears it when the invoice is paid', async () => {
    const { user, customer } = await userWithCustomer();
    const inv = `in_${uid('i')}`;
    const failed = event('invoice.payment_failed', invoice(inv, customer, 'open'));
    await POST(signed(failed));
    await POST(signed(failed));
    let state = await prisma.billingCustomerState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(state.paymentFailedAt).not.toBeNull();
    expect(state.paymentFailedInvoiceId).toBe(inv);

    await POST(signed(event('invoice.paid', invoice(inv, customer, 'paid'))));
    state = await prisma.billingCustomerState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(state.paymentFailedAt).toBeNull();
    const stored = await prisma.stripeInvoice.findUniqueOrThrow({ where: { id: inv } });
    expect(stored.status).toBe('paid');
    expect(stored.hostedInvoiceUrl).toContain(inv);
    expect(await prisma.stripeInvoice.count({ where: { id: inv } })).toBe(1);
  });

  it('records refunded charges idempotently by charge id', async () => {
    const { customer } = await userWithCustomer();
    const charge = { id: `ch_${uid('c')}`, object: 'charge', customer, amount_refunded: 500, currency: 'usd', payment_intent: `pi_${uid('p')}` };
    await POST(signed(event('charge.refunded', charge)));
    await POST(signed(event('charge.refunded', { ...charge, amount_refunded: 1500 })));
    const rows = await prisma.stripeChargeRefund.findMany({ where: { chargeId: charge.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountRefundedCents).toBe(1500);
  });
});

describe('tenant isolation', () => {
  it('only returns the signed-in customer’s invoices and ledger rows', async () => {
    const a = await userWithCustomer();
    const b = await userWithCustomer();
    await POST(signed(event('invoice.paid', invoice(`in_${uid('a')}`, a.customer, 'paid'))));
    await POST(signed(event('invoice.paid', invoice(`in_${uid('b')}`, b.customer, 'paid'))));
    await prisma.billingCustomerState.createMany({ data: [{ userId: a.user.id, invoicesSyncedAt: new Date() }, { userId: b.user.id, invoicesSyncedAt: new Date() }] });

    const aInvoices = await loadCustomerInvoices(a.user.id);
    expect(aInvoices.invoices).toHaveLength(1);
    expect(aInvoices.invoices.every((i) => i.userId === a.user.id)).toBe(true);

    await chargeCredits({ userId: a.user.id, cost: 10, operation: 'agent_run', reason: 'a run', idempotencyKey: uid('k') });
    await chargeCredits({ userId: b.user.id, cost: 20, operation: 'agent_run', reason: 'b run', idempotencyKey: uid('k') });
    await grantCredits({ userId: b.user.id, amount: 50, source: 'PROMO', idempotencyKey: uid('g') });
    const ledgerA = await loadUnifiedLedger(a.user.id);
    expect(ledgerA).toHaveLength(1);
    expect(ledgerA[0].description).toBe('a run');
    expect(ledgerA[0].kind).toBe('SPEND');
    const ledgerB = await loadUnifiedLedger(b.user.id);
    expect(ledgerB.map((e) => e.wallet).sort()).toEqual(['DEVELOPMENT', 'MARKETING']);
    expect(ledgerB.find((e) => e.wallet === 'MARKETING')?.kind).toBe('PROMOTIONAL');
  });
});

describe('spending limits and usage alerts', () => {
  it('sends each 80% / 100% alert once per month however often it is evaluated', async () => {
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { creditBalance: 1000 } });
    await setSpendLimit('USER', user.id, 100, user.id);

    await chargeCredits({ userId: user.id, cost: 85, operation: 'agent_run', reason: 'big run', idempotencyKey: uid('k') });
    await Promise.all([evaluateUsageAlerts(user.id, null), evaluateUsageAlerts(user.id, null), evaluateUsageAlerts(user.id, null)]);
    expect(await prisma.creditUsageAlert.count({ where: { userId: user.id, scope: 'USER' } })).toBe(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);

    await chargeCredits({ userId: user.id, cost: 15, operation: 'agent_run', reason: 'more', idempotencyKey: uid('k') });
    await evaluateUsageAlerts(user.id, null);
    await evaluateUsageAlerts(user.id, null);
    const alerts = await prisma.creditUsageAlert.findMany({ where: { userId: user.id, scope: 'USER' }, orderBy: { threshold: 'asc' } });
    expect(alerts.map((a) => a.threshold)).toEqual([80, 100]);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2);
  });

  it('blocks work that would exceed a user or workspace limit and keeps wallets separate', async () => {
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { creditBalance: 1000 } });
    const { workspace } = await makeProjectFor(user);
    await setSpendLimit('WORKSPACE', workspace.id, 50, user.id);
    await chargeCredits({ userId: user.id, cost: 40, operation: 'agent_run', reason: 'ws run', idempotencyKey: uid('k'), workspaceId: workspace.id });
    await grantCredits({ userId: user.id, amount: 5000, source: 'PURCHASED', idempotencyKey: uid('g') });

    expect((await checkSpendLimits(user.id, workspace.id, 10)).ok).toBe(true);
    const blocked = await checkSpendLimits(user.id, workspace.id, 11);
    expect(blocked.ok).toBe(false);
    // Marketing credits never count toward the development limit.
    expect((await checkSpendLimits(user.id, null, 11)).ok).toBe(true);
  });
});

describe('admin reversals use compensating entries', () => {
  it('refunds a spend once, leaves the original row untouched and rejects UPDATE/DELETE on the ledger', async () => {
    const user = await makeUser();
    const admin = await makeUser({ adminRole: 'ADMIN' });
    await prisma.user.update({ where: { id: user.id }, data: { creditBalance: 100 } });
    const key = uid('k');
    await chargeCredits({ userId: user.id, cost: 40, operation: 'agent_run', reason: 'run', idempotencyKey: key });
    const original = await prisma.creditLedger.findUniqueOrThrow({ where: { idempotencyKey: key } });

    const first = await reverseDevEntry({ entryId: original.id, adminId: admin.id, reason: 'support case' });
    expect(first).toMatchObject({ ok: true, credits: 40, balanceAfter: 100 });
    const second = await reverseDevEntry({ entryId: original.id, adminId: admin.id, reason: 'again' });
    expect(second).toMatchObject({ ok: false, code: 'ALREADY_REVERSED' });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).creditBalance).toBe(100);
    expect(await prisma.creditLedger.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    const compensating = await prisma.creditLedger.findMany({ where: { userId: user.id, refId: original.id } });
    expect(compensating).toHaveLength(1);
    expect(compensating[0].delta).toBe(40);
    expect(await prisma.ledgerReversal.count({ where: { entryId: original.id } })).toBe(1);

    await expect(sql(`UPDATE credit_ledger SET delta = 0 WHERE id = $1`, [original.id])).rejects.toThrow();
    await expect(sql(`DELETE FROM credit_ledger WHERE id = $1`, [original.id])).rejects.toThrow();
  });

  it('refuses to claw back a grant that was already spent', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { creditBalance: 10 } });
    const grant = await prisma.creditLedger.create({
      data: { userId: user.id, delta: 100, reason: 'promo', operation: 'GRANT', source: 'PROMOTIONAL', balanceAfter: 110, idempotencyKey: uid('g') },
    });
    const result = await reverseDevEntry({ entryId: grant.id, adminId: admin.id, reason: 'mistake' });
    expect(result).toMatchObject({ ok: false, code: 'NEGATIVE_BALANCE' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).creditBalance).toBe(10);
  });

  it('reverses a marketing purchase with a compensating deduction, once', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    await grantCredits({ userId: user.id, amount: 200, source: 'PURCHASED', kind: 'PURCHASE', idempotencyKey: uid('g') });
    const purchase = await prisma.marketingLedger.findFirstOrThrow({ where: { userId: user.id, kind: 'PURCHASE' } });
    const first = await reverseMarketingEntry({ entryId: purchase.id, adminId: admin.id, reason: 'chargeback' });
    expect(first).toMatchObject({ ok: true, credits: -200, balanceAfter: 0 });
    const again = await reverseMarketingEntry({ entryId: purchase.id, adminId: admin.id, reason: 'chargeback' });
    expect(again).toMatchObject({ ok: false, code: 'ALREADY_REVERSED' });
    expect((await prisma.marketingWallet.findUniqueOrThrow({ where: { userId: user.id } })).available).toBe(0);
  });
});

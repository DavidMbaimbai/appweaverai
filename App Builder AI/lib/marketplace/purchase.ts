import type Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe';

import { salesState } from './config';
import { earningKey, refundReversal, reversalKey, splitSale } from './earnings';
import { getViewerState } from './catalog';
import { TYPE_SEGMENTS } from './types';

export const CHECKOUT_KIND = 'marketplace_asset';

type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** One-time Stripe Checkout for a paid asset. Blocked unless paid sales are enabled and the fee is configured. */
export async function startCheckout(args: { userId: string; email: string | null; slug: string }): Promise<CheckoutResult> {
  const sales = salesState();
  if (!sales.enabled) return { ok: false, error: sales.reason };

  const asset = await prisma.marketplaceAsset.findFirst({
    where: { slug: args.slug, status: 'PUBLISHED', priceCents: { gt: 0 }, publishedVersion: { not: null } },
    select: { id: true, slug: true, type: true, title: true, priceCents: true, currency: true, publishedVersion: true },
  });
  if (!asset || asset.publishedVersion === null) return { ok: false, error: 'This asset is not for sale.' };
  const version = await prisma.marketplaceAssetVersion.findUnique({
    where: { assetId_version: { assetId: asset.id, version: asset.publishedVersion } },
    select: { id: true, status: true },
  });
  if (!version || version.status !== 'PUBLISHED') return { ok: false, error: 'This asset is not for sale.' };

  const viewer = await getViewerState(args.userId, asset.id);
  if (viewer.isCreator) return { ok: false, error: 'You own this asset.' };
  if (viewer.hasPaidOrder) return { ok: false, error: 'You already purchased this asset.' };

  const base = getAppBaseUrl();
  const returnUrl = `${base}/marketplace/${TYPE_SEGMENTS[asset.type]}/${asset.slug}`;
  const metadata = { kind: CHECKOUT_KIND, userId: args.userId, assetId: asset.id, versionId: version.id };
  const session = await getStripeClient().checkout.sessions.create({
    mode: 'payment',
    customer_email: args.email ?? undefined,
    line_items: [
      { quantity: 1, price_data: { currency: asset.currency, unit_amount: asset.priceCents, product_data: { name: asset.title.slice(0, 120) } } },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${returnUrl}?purchase=success`,
    cancel_url: `${returnUrl}?purchase=cancelled`,
  });
  if (!session.url) return { ok: false, error: 'Stripe did not return a checkout link.' };

  await prisma.marketplaceOrder.create({
    data: {
      userId: args.userId,
      assetId: asset.id,
      versionId: version.id,
      status: 'PENDING',
      amountCents: asset.priceCents,
      currency: asset.currency,
      platformFeeBps: sales.feeBps,
      stripeSessionId: session.id,
    },
  });
  return { ok: true, url: session.url };
}

/**
 * Called ONLY from the verified Stripe webhook (after the event id is claimed). Safe to call twice: the PENDING -> PAID
 * transition is a single conditional update, and the ledger line has a unique idempotency key.
 */
export async function recordPaidOrder(session: Stripe.Checkout.Session, stripeEventId: string): Promise<{ recorded: boolean; reason?: string }> {
  if (session.metadata?.kind !== CHECKOUT_KIND) return { recorded: false, reason: 'not_marketplace' };
  if (session.payment_status !== 'paid') return { recorded: false, reason: 'unpaid' };

  const order = await prisma.marketplaceOrder.findUnique({
    where: { stripeSessionId: session.id },
    include: { asset: { select: { creatorId: true, currency: true } } },
  });
  if (!order) return { recorded: false, reason: 'unknown_order' };
  // Never trust the metadata alone: the paid amount and the buyer must match the order we created.
  if (session.amount_total !== order.amountCents || session.metadata.userId !== order.userId || order.assetId !== session.metadata.assetId) {
    await prisma.marketplaceOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
    return { recorded: false, reason: 'mismatch' };
  }

  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
  const feeBps = order.platformFeeBps ?? 0;
  const split = splitSale(order.amountCents, feeBps);

  const claimed = await prisma.marketplaceOrder.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      paymentIntentId,
      stripeEventId,
      platformFeeCents: split.platformFeeCents,
      creatorShareCents: split.creatorShareCents,
    },
  });
  // A retry after a crash between the claim and the ledger write must still produce the (idempotent) ledger line.
  let shareCents = split.creatorShareCents;
  if (claimed.count === 0) {
    const fresh = await prisma.marketplaceOrder.findUnique({ where: { id: order.id }, select: { status: true, creatorShareCents: true } });
    if (!fresh || fresh.status === 'PENDING' || fresh.status === 'FAILED') return { recorded: false, reason: 'already_processed' };
    shareCents = fresh.creatorShareCents;
  }

  if (order.asset.creatorId && shareCents > 0) {
    await prisma.marketplacePayoutLedger.createMany({
      data: [
        {
          creatorId: order.asset.creatorId,
          orderId: order.id,
          kind: 'EARNING',
          amountCents: shareCents,
          currency: order.currency,
          idempotencyKey: earningKey(order.id),
          note: 'Sale',
        },
      ],
      skipDuplicates: true,
    });
  }
  return claimed.count === 1 ? { recorded: true } : { recorded: false, reason: 'already_processed' };
}

/** Called from the verified webhook on `charge.refunded`. Reverses the creator's earning pro rata; revokes the purchase on a full refund. */
export async function reverseRefund(charge: Stripe.Charge): Promise<{ reversedCents: number }> {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id ?? null);
  if (!paymentIntentId) return { reversedCents: 0 };
  const order = await prisma.marketplaceOrder.findUnique({
    where: { paymentIntentId },
    include: { asset: { select: { creatorId: true } } },
  });
  if (!order || order.status === 'PENDING' || order.status === 'FAILED') return { reversedCents: 0 };

  const reversedBefore = await prisma.marketplacePayoutLedger.aggregate({
    where: { orderId: order.id, kind: 'REFUND_REVERSAL' },
    _sum: { amountCents: true },
  });
  const calc = refundReversal({
    amountCents: order.amountCents,
    creatorShareCents: order.creatorShareCents,
    refundedBeforeCents: order.refundedCents,
    reversedBeforeCents: -(reversedBefore._sum.amountCents ?? 0),
    totalRefundedCents: charge.amount_refunded,
  });
  if (calc.refundedCents <= order.refundedCents) return { reversedCents: 0 };

  const orderUpdate = prisma.marketplaceOrder.update({
    where: { id: order.id },
    data: { refundedCents: calc.refundedCents, status: calc.refundedCents >= order.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  });
  // One transaction: the order cannot show the refund without its ledger reversal, so a retried webhook is safe.
  if (order.asset.creatorId && calc.reverseCents > 0) {
    await prisma.$transaction([
      orderUpdate,
      prisma.marketplacePayoutLedger.createMany({
        data: [
          {
            creatorId: order.asset.creatorId,
            orderId: order.id,
            kind: 'REFUND_REVERSAL',
            amountCents: -calc.reverseCents,
            currency: order.currency,
            idempotencyKey: reversalKey(order.id, calc.refundedCents),
            note: 'Refund',
          },
        ],
        skipDuplicates: true,
      }),
    ]);
  } else {
    await orderUpdate;
  }
  return { reversedCents: calc.reverseCents };
}

/** Earnings summary for the creator dashboard. */
export async function creatorEarnings(creatorId: string) {
  const [lines, orders] = await Promise.all([
    prisma.marketplacePayoutLedger.findMany({ where: { creatorId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, kind: true, amountCents: true, currency: true, note: true, createdAt: true } }),
    prisma.marketplaceOrder.count({ where: { asset: { creatorId }, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }),
  ]);
  const total = await prisma.marketplacePayoutLedger.aggregate({ where: { creatorId }, _sum: { amountCents: true } });
  return { lines, orders, balanceCents: total._sum.amountCents ?? 0 };
}

import { NOT_AVAILABLE } from '@/lib/marketing-credits/reports';
import { prisma } from '@/lib/prisma';

import { arrRunRate, grossMargin, mrrSnapshot, mrrTrend, payingCount, planMix, retention, totalMrr, type MrrChange } from './math';

const REPORT_CURRENCY = 'usd';
const DAY = 86_400_000;

type Na = typeof NOT_AVAILABLE;
const orNa = <T>(value: T | null | undefined): T | Na => (value === null || value === undefined ? NOT_AVAILABLE : value);

/**
 * Everything on the revenue dashboard. Figures come only from webhook-synced Stripe tables;
 * when there is no data behind a figure it is `'not available'`, never zero or an estimate.
 */
export async function loadRevenueOverview(now = new Date()) {
  const [changesAll, subscriptionCount, recentInvoices, renewals] = await Promise.all([
    prisma.stripeSubscriptionMrrChange.findMany({
      select: { subscriptionId: true, planId: true, mrrCents: true, effectiveAt: true, currency: true },
    }),
    prisma.stripeSubscription.count(),
    prisma.stripeInvoice.findMany({ orderBy: { stripeCreatedAt: 'desc' }, take: 10 }),
    prisma.stripeSubscription.findMany({
      where: { status: { in: ['active', 'trialing'] }, cancelAtPeriodEnd: false, currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + 30 * DAY) } },
      orderBy: { currentPeriodEnd: 'asc' },
      take: 10,
      select: { id: true, planId: true, mrrCents: true, currency: true, currentPeriodEnd: true, userId: true },
    }),
  ]);

  const hasData = subscriptionCount > 0;
  const usd: MrrChange[] = changesAll.filter((c) => c.currency === REPORT_CURRENCY);
  const excludedCurrencies = [...new Set(changesAll.filter((c) => c.currency !== REPORT_CURRENCY).map((c) => c.currency))];
  const snapshot = mrrSnapshot(usd, now);
  const mrr = totalMrr(snapshot);

  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const monthRetention = hasData ? retention(usd, monthAgo, now) : null;
  const firstChange = usd.reduce<Date | null>((min, c) => (!min || c.effectiveAt < min ? c.effectiveAt : min), null);
  // Retention over a window that begins before any data was recorded would be meaningless.
  const retentionWindowCovered = firstChange !== null && firstChange <= monthAgo;
  const measured = retentionWindowCovered ? monthRetention : null;

  const periodStart = new Date(now.getTime() - 30 * DAY);
  const [paidInvoices, purchases, refunds, aiCost, aiCount, mktCosts] = await Promise.all([
    prisma.stripeInvoice.aggregate({
      where: { status: 'paid', currency: REPORT_CURRENCY, paidAt: { gte: periodStart }, amountPaidCents: { gt: 0 } },
      _sum: { amountPaidCents: true },
      _count: true,
    }),
    prisma.marketingPurchase.findMany({
      where: { createdAt: { gte: periodStart }, currency: REPORT_CURRENCY },
      select: { amountCents: true, paymentIntentId: true, credits: true },
    }),
    prisma.stripeChargeRefund.findMany({ where: { currency: REPORT_CURRENCY, paymentIntentId: { not: null } }, select: { paymentIntentId: true, amountRefundedCents: true } }),
    prisma.aiUsageEvent.aggregate({ where: { createdAt: { gte: periodStart } }, _sum: { estimatedCostCents: true } }),
    prisma.aiUsageEvent.count({ where: { createdAt: { gte: periodStart } } }),
    prisma.internalMarketingCost.findMany({
      where: { createdAt: { gte: periodStart } },
      select: { estimatedCostCents: true, actualCostCents: true },
    }),
  ]);

  const refundByIntent = new Map(refunds.map((r) => [r.paymentIntentId as string, r.amountRefundedCents]));
  const packGross = purchases.reduce((s, p) => s + p.amountCents, 0);
  const packRefunded = purchases.reduce((s, p) => s + Math.min(p.amountCents, p.paymentIntentId ? (refundByIntent.get(p.paymentIntentId) ?? 0) : 0), 0);
  const packNet = packGross - packRefunded;

  const subscriptionRevenue = paidInvoices._count > 0 ? (paidInvoices._sum.amountPaidCents ?? 0) : null;
  const devCost = aiCount > 0 ? (aiCost._sum.estimatedCostCents ?? 0) : null;
  const marketingRevenue = purchases.length > 0 ? packNet : null;
  const marketingCost = mktCosts.length > 0 ? mktCosts.reduce((s, c) => s + (c.actualCostCents ?? c.estimatedCostCents), 0) : null;

  return {
    currency: REPORT_CURRENCY,
    excludedCurrencies,
    hasData,
    kpis: {
      mrrCents: hasData ? mrr : NOT_AVAILABLE,
      arrCents: hasData ? arrRunRate(mrr) : NOT_AVAILABLE,
      activeSubscriptions: hasData ? payingCount(snapshot) : NOT_AVAILABLE,
      payingCustomers: hasData ? new Set(await payingUserIds(snapshot)).size : NOT_AVAILABLE,
      netRevenueRetention: orNa(measured?.netRevenueRetention),
      grossRevenueChurn: orNa(measured?.grossRevenueChurn),
      customerChurn: orNa(measured?.customerChurn),
    },
    retention: measured,
    trend: hasData ? mrrTrend(usd, 12, now) : null,
    planMix: hasData ? planMix(snapshot) : null,
    recentInvoices,
    renewals,
    creditPacks: {
      revenueCents: orNa(marketingRevenue),
      grossCents: purchases.length > 0 ? packGross : NOT_AVAILABLE,
      refundedCents: purchases.length > 0 ? packRefunded : NOT_AVAILABLE,
      purchases: purchases.length,
    },
    margin: {
      windowDays: 30,
      development: {
        revenueCents: orNa(subscriptionRevenue),
        providerCostCents: orNa(devCost),
        grossMargin: orNa(grossMargin(subscriptionRevenue, devCost)),
      },
      marketing: {
        revenueCents: orNa(marketingRevenue),
        providerCostCents: orNa(marketingCost),
        grossMargin: orNa(grossMargin(marketingRevenue, marketingCost)),
      },
    },
  };
}

async function payingUserIds(snapshot: Map<string, { mrrCents: number }>) {
  const ids = [...snapshot.entries()].filter(([, s]) => s.mrrCents > 0).map(([id]) => id);
  if (ids.length === 0) return [];
  const rows = await prisma.stripeSubscription.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, customerId: true } });
  return rows.map((r) => r.userId ?? r.customerId);
}

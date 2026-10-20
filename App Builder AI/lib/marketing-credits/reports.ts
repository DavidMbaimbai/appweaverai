import { prisma } from '@/lib/prisma';

import { getActivePrices, type ActivePrice, type MarketingOperation } from './pricing';

export type LedgerRow = {
  orgId: string | null;
  kind: string;
  delta: number;
  operation: string | null;
  createdAt: Date;
};
export type PurchaseRow = { amountCents: number; credits: number };
export type InternalRow = { operation: string; provider: string; estimatedCostCents: number; actualCostCents: number | null };

export const NOT_AVAILABLE = 'not available' as const;

export type ReportSummary = {
  purchasedCredits: number;
  consumedCredits: number;
  refundedCredits: number;
  failedOperations: number;
  byOrg: Array<{ orgId: string; consumed: number }>;
  byOperation: Array<{ operation: string; consumed: number; providerCostCents: number | typeof NOT_AVAILABLE }>;
  providerCostCents: number | typeof NOT_AVAILABLE;
  /** Cash received for packages. */
  purchaseRevenueCents: number;
  /** Customer marketing revenue recognised from consumed credits at the average package price. */
  consumedRevenueCents: number | typeof NOT_AVAILABLE;
  grossMarginCents: number | typeof NOT_AVAILABLE;
  /** Internal spend is reported separately and never counted in customer revenue or margin. */
  internal: {
    totalEstimatedCents: number;
    totalActualCents: number;
    byOperation: Array<{ operation: string; provider: string; estimatedCents: number; actualCents: number; count: number }>;
  };
};

export function summarizeReport(input: {
  ledger: LedgerRow[];
  purchases: PurchaseRow[];
  internal: InternalRow[];
  prices: Map<MarketingOperation, ActivePrice>;
}): ReportSummary {
  let purchased = 0;
  let consumed = 0;
  let refunded = 0;
  let failed = 0;
  const orgs = new Map<string, number>();
  const ops = new Map<string, number>();

  for (const row of input.ledger) {
    if (row.kind === 'PURCHASE') purchased += row.delta;
    if (row.kind === 'SETTLE') {
      const used = -row.delta;
      consumed += used;
      orgs.set(row.orgId ?? 'unknown', (orgs.get(row.orgId ?? 'unknown') ?? 0) + used);
      ops.set(row.operation ?? 'unknown', (ops.get(row.operation ?? 'unknown') ?? 0) + used);
    }
    if (row.kind === 'REFUND') {
      refunded += row.delta;
      failed += 1;
    }
    if (row.kind === 'RELEASE') failed += 1;
  }

  let totalCost = 0;
  let anyCost = false;
  const byOperation = [...ops.entries()]
    .map(([operation, used]) => {
      const price = input.prices.get(operation as MarketingOperation);
      let providerCostCents: number | typeof NOT_AVAILABLE = NOT_AVAILABLE;
      if (price?.costCents != null && price.creditCost > 0) {
        providerCostCents = Math.round((used / price.creditCost) * price.costCents);
        totalCost += providerCostCents;
        anyCost = true;
      }
      return { operation, consumed: used, providerCostCents };
    })
    .sort((a, b) => b.consumed - a.consumed);

  const purchaseRevenueCents = input.purchases.reduce((s, p) => s + p.amountCents, 0);
  const purchasedFromPackages = input.purchases.reduce((s, p) => s + p.credits, 0);
  const consumedRevenueCents =
    purchasedFromPackages > 0 ? Math.round((consumed * purchaseRevenueCents) / purchasedFromPackages) : NOT_AVAILABLE;
  const providerCostCents = anyCost ? totalCost : NOT_AVAILABLE;

  const internalMap = new Map<string, { operation: string; provider: string; estimatedCents: number; actualCents: number; count: number }>();
  for (const row of input.internal) {
    const key = `${row.operation}|${row.provider}`;
    const entry = internalMap.get(key) ?? { operation: row.operation, provider: row.provider, estimatedCents: 0, actualCents: 0, count: 0 };
    entry.estimatedCents += row.estimatedCostCents;
    entry.actualCents += row.actualCostCents ?? row.estimatedCostCents;
    entry.count += 1;
    internalMap.set(key, entry);
  }
  const internalRows = [...internalMap.values()];

  return {
    purchasedCredits: purchased,
    consumedCredits: consumed,
    refundedCredits: refunded,
    failedOperations: failed,
    byOrg: [...orgs.entries()].map(([orgId, c]) => ({ orgId, consumed: c })).sort((a, b) => b.consumed - a.consumed),
    byOperation,
    providerCostCents,
    purchaseRevenueCents,
    consumedRevenueCents,
    grossMarginCents:
      typeof consumedRevenueCents === 'number' && typeof providerCostCents === 'number'
        ? consumedRevenueCents - providerCostCents
        : NOT_AVAILABLE,
    internal: {
      totalEstimatedCents: internalRows.reduce((s, r) => s + r.estimatedCents, 0),
      totalActualCents: internalRows.reduce((s, r) => s + r.actualCents, 0),
      byOperation: internalRows.sort((a, b) => b.actualCents - a.actualCents),
    },
  };
}

/** Flags orgs whose recent usage is far above their own recent daily average. */
export function detectAnomalies(
  recent: Array<{ orgId: string; consumed: number }>,
  baselineDaily: Map<string, number>,
  options: { multiplier?: number; minCredits?: number } = {},
) {
  const multiplier = options.multiplier ?? 5;
  const minCredits = options.minCredits ?? 200;
  return recent
    .filter((r) => {
      if (r.consumed < minCredits) return false;
      const base = baselineDaily.get(r.orgId) ?? 0;
      return base === 0 || r.consumed > base * multiplier;
    })
    .map((r) => ({ ...r, baselineDaily: baselineDaily.get(r.orgId) ?? 0 }));
}

export async function loadReport(since: Date) {
  const [ledger, purchases, internal, prices] = await Promise.all([
    prisma.marketingLedger.findMany({
      where: { createdAt: { gte: since }, kind: { in: ['PURCHASE', 'SETTLE', 'REFUND', 'RELEASE'] } },
      select: { orgId: true, kind: true, delta: true, operation: true, createdAt: true },
      take: 20000,
    }),
    prisma.marketingPurchase.findMany({ where: { createdAt: { gte: since } }, select: { amountCents: true, credits: true } }),
    prisma.internalMarketingCost.findMany({
      where: { createdAt: { gte: since } },
      select: { operation: true, provider: true, estimatedCostCents: true, actualCostCents: true },
      take: 20000,
    }),
    getActivePrices(),
  ]);
  const summary = summarizeReport({ ledger, purchases, internal, prices });

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600_000);
  const weekAgo = new Date(now - 8 * 24 * 3600_000);
  const recentRows = await prisma.marketingLedger.findMany({
    where: { kind: 'SETTLE', createdAt: { gte: weekAgo } },
    select: { orgId: true, delta: true, createdAt: true },
    take: 20000,
  });
  const recent = new Map<string, number>();
  const baseline = new Map<string, number>();
  for (const row of recentRows) {
    const org = row.orgId ?? 'unknown';
    if (row.createdAt >= dayAgo) recent.set(org, (recent.get(org) ?? 0) - row.delta);
    else baseline.set(org, (baseline.get(org) ?? 0) - row.delta / 7);
  }
  const anomalies = detectAnomalies([...recent.entries()].map(([orgId, consumed]) => ({ orgId, consumed })), baseline);
  const controls = await prisma.marketingOrgControl.findMany({ take: 500 });
  return { summary, anomalies, controls };
}

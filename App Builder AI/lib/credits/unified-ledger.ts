import { prisma } from '@/lib/prisma';

export type LedgerKind = 'PURCHASED' | 'PROMOTIONAL' | 'SUBSCRIPTION' | 'SPEND' | 'REFUND' | 'EXPIRY' | 'ADJUSTMENT';
export type LedgerWallet = 'DEVELOPMENT' | 'MARKETING';

export type UnifiedEntry = {
  id: string;
  wallet: LedgerWallet;
  createdAt: Date;
  kind: LedgerKind;
  description: string;
  delta: number;
  balanceAfter: number;
};

export const KIND_LABELS: Record<LedgerKind, string> = {
  PURCHASED: 'Purchased',
  PROMOTIONAL: 'Promotional',
  SUBSCRIPTION: 'Subscription allowance',
  SPEND: 'Spend',
  REFUND: 'Refund',
  EXPIRY: 'Expiry',
  ADJUSTMENT: 'Adjustment',
};

const DEV_SOURCES: Record<string, LedgerKind> = {
  PURCHASED: 'PURCHASED',
  PROMOTIONAL: 'PROMOTIONAL',
  SUBSCRIPTION: 'SUBSCRIPTION',
  ADJUSTMENT: 'ADJUSTMENT',
};

/** Classifies a development ledger row; rows written before `source` existed are inferred from operation/reason. */
export function classifyDevEntry(row: { operation: string; delta: number; reason: string; source: string | null }): LedgerKind {
  if (row.source && DEV_SOURCES[row.source]) return DEV_SOURCES[row.source];
  if (row.operation === 'REFUND') return 'REFUND';
  if (row.operation === 'ADJUSTMENT') return 'ADJUSTMENT';
  if (row.operation === 'GRANT') return /plan|subscription|monthly/i.test(row.reason) ? 'SUBSCRIPTION' : 'PROMOTIONAL';
  return row.delta < 0 ? 'SPEND' : 'ADJUSTMENT';
}

export function classifyMarketingEntry(row: { kind: string; source: string | null }): LedgerKind | null {
  switch (row.kind) {
    case 'PURCHASE':
      return 'PURCHASED';
    case 'GRANT':
      return row.source === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : row.source === 'PURCHASED' ? 'PURCHASED' : 'PROMOTIONAL';
    case 'SETTLE':
      return 'SPEND';
    case 'REFUND':
      return 'REFUND';
    case 'EXPIRY':
      return 'EXPIRY';
    case 'ADJUSTMENT':
      return 'ADJUSTMENT';
    default:
      return null;
  }
}

/**
 * The signed-in customer's own entries from both wallets, newest first. Every query is
 * scoped by `userId`; the two balances are never merged, only listed side by side.
 */
export async function loadUnifiedLedger(userId: string, options: { limit?: number; from?: Date; to?: Date } = {}): Promise<UnifiedEntry[]> {
  const limit = Math.min(5000, Math.max(1, options.limit ?? 200));
  const createdAt = options.from || options.to ? { gte: options.from, lte: options.to } : undefined;
  const [dev, marketing] = await Promise.all([
    prisma.creditLedger.findMany({ where: { userId, createdAt }, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.marketingLedger.findMany({ where: { userId, createdAt, NOT: { delta: 0 } }, orderBy: { createdAt: 'desc' }, take: limit }),
  ]);

  const entries: UnifiedEntry[] = [];
  for (const r of dev) {
    entries.push({
      id: r.id,
      wallet: 'DEVELOPMENT',
      createdAt: r.createdAt,
      kind: classifyDevEntry(r),
      description: r.reason,
      delta: r.delta,
      balanceAfter: r.balanceAfter,
    });
  }
  for (const r of marketing) {
    const kind = classifyMarketingEntry(r);
    if (!kind) continue;
    entries.push({
      id: r.id,
      wallet: 'MARKETING',
      createdAt: r.createdAt,
      kind,
      description: r.note ?? r.operation ?? r.kind.toLowerCase(),
      delta: r.delta,
      balanceAfter: r.balanceAfter,
    });
  }
  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

/** Neutralises spreadsheet formula injection and quotes fields that need it. */
export function csvCell(value: string | number | Date): string {
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function ledgerToCsv(entries: UnifiedEntry[]): string {
  const header = ['Date (UTC)', 'Wallet', 'Type', 'Description', 'Credits', 'Balance after'];
  const lines = entries.map((e) =>
    [e.createdAt, e.wallet === 'DEVELOPMENT' ? 'Development' : 'Marketing', KIND_LABELS[e.kind], e.description, e.delta, e.balanceAfter]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}

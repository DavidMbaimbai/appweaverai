import { prisma } from '@/lib/prisma';

import { DEFAULT_MARKETING_PRICES, type MarketingOperation } from './pricing';

/** Logs a house operation using the catalogue's provider cost estimate (never touches a wallet). */
export async function recordInternalOperation(
  operation: MarketingOperation,
  ref: { refType?: string; refId?: string; units?: number } = {},
) {
  const def = DEFAULT_MARKETING_PRICES.find((p) => p.operation === operation);
  await recordInternalCost({
    operation,
    provider: def?.provider ?? 'unknown',
    estimatedCostCents: (def?.costCents ?? 0) * Math.max(1, ref.units ?? 1),
    refType: ref.refType,
    refId: ref.refId,
  });
}

export type InternalCostInput = {
  operation: string;
  provider: string;
  estimatedCostCents: number;
  actualCostCents?: number | null;
  refType?: string;
  refId?: string;
  adminId?: string;
};

/**
 * House (platform) marketing spend. Never touches a customer wallet; failures here
 * must not break the marketing job itself.
 */
export async function recordInternalCost(input: InternalCostInput) {
  try {
    await prisma.internalMarketingCost.create({
      data: {
        billing: 'APPWEAVER_INTERNAL',
        operation: input.operation,
        provider: input.provider,
        estimatedCostCents: Math.max(0, Math.round(input.estimatedCostCents)),
        actualCostCents: input.actualCostCents == null ? null : Math.max(0, Math.round(input.actualCostCents)),
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        adminId: input.adminId ?? null,
      },
    });
  } catch (error) {
    console.error('[marketing-credits] internal cost not recorded:', error);
  }
}

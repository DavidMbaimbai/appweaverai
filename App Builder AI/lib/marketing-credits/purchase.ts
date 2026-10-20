import { prisma } from '@/lib/prisma';

import { grantCredits } from './wallet';

export type PurchaseInput = {
  userId: string;
  packageId?: string | null;
  packageName: string;
  credits: number;
  amountCents: number;
  currency: string;
  stripeSessionId: string;
  paymentIntentId?: string | null;
  stripeEventId?: string | null;
  receiptUrl?: string | null;
};

/**
 * Called ONLY from the verified Stripe webhook. Replayed events or a second event for
 * the same session/payment intent change nothing (idempotent on session and intent).
 */
export async function grantPurchase(input: PurchaseInput): Promise<{ granted: boolean }> {
  if (input.paymentIntentId) {
    const seen = await prisma.marketingPurchase.findUnique({ where: { paymentIntentId: input.paymentIntentId } });
    if (seen) return { granted: false };
  }
  const result = await grantCredits({
    userId: input.userId,
    amount: input.credits,
    source: 'PURCHASED',
    kind: 'PURCHASE',
    idempotencyKey: `purchase:${input.stripeSessionId}`,
    refType: 'stripe_session',
    refId: input.stripeSessionId,
    note: `Purchased ${input.packageName}`,
  });
  if (!result.granted) return { granted: false };
  await prisma.marketingPurchase.upsert({
    where: { stripeSessionId: input.stripeSessionId },
    create: {
      userId: input.userId,
      packageId: input.packageId ?? null,
      packageName: input.packageName,
      credits: input.credits,
      amountCents: input.amountCents,
      currency: input.currency,
      stripeSessionId: input.stripeSessionId,
      paymentIntentId: input.paymentIntentId ?? null,
      stripeEventId: input.stripeEventId ?? null,
      receiptUrl: input.receiptUrl ?? null,
    },
    update: {},
  });
  return { granted: true };
}

export const DEFAULT_PACKAGES = [
  { name: 'Starter 500', credits: 500, priceCents: 900, sortOrder: 1 },
  { name: 'Growth 2,000', credits: 2000, priceCents: 2900, sortOrder: 2 },
  { name: 'Scale 10,000', credits: 10000, priceCents: 12900, sortOrder: 3 },
];

export async function listActivePackages() {
  const packages = await prisma.marketingPackage.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  if (packages.length > 0) return packages;
  return DEFAULT_PACKAGES.map((p) => ({ id: `default:${p.sortOrder}`, currency: 'usd', active: true, ...p }));
}

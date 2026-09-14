import { prisma } from '@/lib/prisma';
import { fetchProPlanInfo, getStripeClient, isStripeConfigured } from '@/lib/stripe';

export type RevenueSummary = {
  configured: boolean;
  configError: string | null;
  payingUsers: number;
  mrrCents: number | null;
  arrCents: number | null;
  refunds30dCents: number | null;
  planPriceLabel: string | null;
};

export async function getRevenueSummary(): Promise<RevenueSummary> {
  if (!isStripeConfigured()) {
    return {
      configured: false,
      configError: 'Stripe is not configured.',
      payingUsers: 0,
      mrrCents: null,
      arrCents: null,
      refunds30dCents: null,
      planPriceLabel: null,
    };
  }

  const [payingUsers, proPlanInfo] = await Promise.all([
    prisma.user.count({
      where: {
        subscriptionPlan: { not: 'free' },
        accountStatus: 'ACTIVE',
      },
    }),
    fetchProPlanInfo(),
  ]);

  if (!proPlanInfo.configured || proPlanInfo.displayMonthlyPrice == null) {
    return {
      configured: false,
      configError: proPlanInfo.configError,
      payingUsers,
      mrrCents: null,
      arrCents: null,
      refunds30dCents: null,
      planPriceLabel: proPlanInfo.formattedPrice,
    };
  }

  const monthlyPriceCents = Math.round(proPlanInfo.displayMonthlyPrice * 100);
  const mrrCents = payingUsers * monthlyPriceCents;
  const arrCents = mrrCents * 12;
  const thirtyDaysAgoUnix = Math.floor(
    (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000,
  );

  // Best-effort only: this single page of Refund objects is enough for MVP KPIs,
  // but full reconciliation would need pagination and a durable revenue ledger.
  const refunds = await getStripeClient().refunds.list({
    created: { gte: thirtyDaysAgoUnix },
    limit: 100,
  });

  return {
    configured: true,
    configError: null,
    payingUsers,
    mrrCents,
    arrCents,
    refunds30dCents: refunds.data.reduce(
      (total, refund) => total + refund.amount,
      0,
    ),
    planPriceLabel: proPlanInfo.formattedPrice,
  };
}

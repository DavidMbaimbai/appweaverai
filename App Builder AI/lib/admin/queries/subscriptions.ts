import type Stripe from 'stripe';

import { formatBillingInterval, formatStripePrice, getStripeClient, isStripeConfigured } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';

export type LiveSubscriptionItem = {
  id: string;
  productName: string | null;
  priceId: string;
  priceLabel: string | null;
  intervalLabel: string | null;
  quantity: number | null;
};

export type LiveSubscriptionSummary = {
  subscriptionId: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  items: LiveSubscriptionItem[];
};

export type SubscriptionListItem = {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  subscriptionPlan: string;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  createdAt: Date;
  liveSubscription: LiveSubscriptionSummary | null;
};

export type SubscriptionListResult = {
  users: SubscriptionListItem[];
  total: number;
  page: number;
  pageSize: number;
  stripeConfigured: boolean;
};

type SubscriptionListFilters = {
  search?: string;
  plan?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

function toDate(value: number | null) {
  return value ? new Date(value * 1000) : null;
}

function getProductName(product: string | Stripe.Product | Stripe.DeletedProduct) {
  if (typeof product === 'string') return null;
  if ('deleted' in product && product.deleted) return null;
  return product.name;
}

function mapLiveSubscriptionSummary(
  subscription: Stripe.Subscription,
): LiveSubscriptionSummary {
  const periodStarts = subscription.items.data.map(
    (item) => item.current_period_start,
  );
  const periodEnds = subscription.items.data.map((item) => item.current_period_end);

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodStart: toDate(
      periodStarts.length > 0 ? Math.min(...periodStarts) : null,
    ),
    currentPeriodEnd: toDate(periodEnds.length > 0 ? Math.max(...periodEnds) : null),
    trialEnd: toDate(subscription.trial_end),
    cancelAt: toDate(subscription.cancel_at),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    items: subscription.items.data.map((item) => ({
      id: item.id,
      productName: getProductName(item.price.product),
      priceId: item.price.id,
      priceLabel:
        item.price.unit_amount != null ? formatStripePrice(item.price) : null,
      intervalLabel: formatBillingInterval(item.price),
      quantity: item.quantity ?? null,
    })),
  };
}

async function fetchLiveSubscriptionMap(
  subscriptionIds: string[],
): Promise<Map<string, LiveSubscriptionSummary>> {
  if (!isStripeConfigured() || subscriptionIds.length === 0) {
    return new Map();
  }

  const stripe = getStripeClient();
  const uniqueIds = Array.from(new Set(subscriptionIds));

  const entries = await Promise.all(
    uniqueIds.map(async (subscriptionId) => {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId,
          { expand: ['items.data.price.product'] },
        );

        return [subscriptionId, mapLiveSubscriptionSummary(subscription)] as const;
      } catch {
        return [subscriptionId, null] as const;
      }
    }),
  );

  return new Map(
    entries.filter(
      (
        entry,
      ): entry is readonly [string, LiveSubscriptionSummary] => entry[1] !== null,
    ),
  );
}

export async function listSubscriptions(
  filters: SubscriptionListFilters,
): Promise<SubscriptionListResult> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const whereParts: Prisma.UserWhereInput[] = [
    {
      OR: [
        { stripeSubscriptionId: { not: null } },
        { subscriptionPlan: { not: 'free' } },
      ],
    },
  ];

  const search = filters.search?.trim();
  if (search) {
    whereParts.push({
      OR: [
        { id: search },
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { stripeSubscriptionId: search },
      ],
    });
  }

  if (filters.plan) {
    whereParts.push({ subscriptionPlan: filters.plan });
  }

  if (filters.status) {
    whereParts.push({ subscriptionStatus: filters.status });
  }

  const where: Prisma.UserWhereInput =
    whereParts.length === 1 ? whereParts[0] : { AND: whereParts };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  const liveSubscriptionMap = await fetchLiveSubscriptionMap(
    users
      .map((user) => user.stripeSubscriptionId)
      .filter((value): value is string => Boolean(value)),
  );

  return {
    users: users.map((user) => ({
      ...user,
      liveSubscription: user.stripeSubscriptionId
        ? liveSubscriptionMap.get(user.stripeSubscriptionId) ?? null
        : null,
    })),
    total,
    page,
    pageSize,
    stripeConfigured: isStripeConfigured(),
  };
}

export async function getSubscriptionDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      createdAt: true,
      accountStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
    },
  });

  if (!user) return null;

  const liveSubscriptionMap = await fetchLiveSubscriptionMap(
    user.stripeSubscriptionId ? [user.stripeSubscriptionId] : [],
  );

  return {
    user,
    stripeConfigured: isStripeConfigured(),
    liveSubscription: user.stripeSubscriptionId
      ? liveSubscriptionMap.get(user.stripeSubscriptionId) ?? null
      : null,
  };
}

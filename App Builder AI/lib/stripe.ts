import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export type ProPlanInfo = {
  configured: boolean;
  priceId: string | null;
  productId: string | null;
  formattedPrice: string | null;
  intervalLabel: string | null;
  displayMonthlyPrice: number | null;
  mode: 'test' | 'live' | null;
  configError: string | null;
};

export type PaidPlanId = 'builder' | 'pro' | 'business';
export type BillingPeriod = 'monthly' | 'yearly';

const PLAN_PRICE_ENV_VARS: Record<
  PaidPlanId,
  Record<BillingPeriod, string>
> = {
  builder: {
    monthly: 'STRIPE_BUILDER_MONTHLY_PRICE_ID',
    yearly: 'STRIPE_BUILDER_YEARLY_PRICE_ID',
  },
  pro: {
    monthly: 'STRIPE_PRO_MONTHLY_PRICE_ID',
    yearly: 'STRIPE_PRO_YEARLY_PRICE_ID',
  },
  business: {
    monthly: 'STRIPE_BUSINESS_MONTHLY_PRICE_ID',
    yearly: 'STRIPE_BUSINESS_YEARLY_PRICE_ID',
  },
};

/** Resolves the Checkout price ID for a specific paid plan + billing period. */
export function resolvePriceIdForPlan(
  planId: PaidPlanId,
  period: BillingPeriod,
): string {
  const envVar = PLAN_PRICE_ENV_VARS[planId][period];
  const priceId = process.env[envVar]?.trim();

  if (!priceId) {
    throw new Error(
      `Set ${envVar} (price_...) in your environment to enable checkout for the ${planId} plan.`,
    );
  }

  return priceId;
}

export function isPlanCheckoutConfigured(
  planId: PaidPlanId,
  period: BillingPeriod,
): boolean {
  const envVar = PLAN_PRICE_ENV_VARS[planId][period];
  return Boolean(process.env[envVar]?.trim());
}

/** All configured plan price IDs, keyed by price ID, for validating checkout sessions. */
export function getPlanIdsByPriceId(): Record<string, PaidPlanId> {
  const map: Record<string, PaidPlanId> = {};

  for (const planId of Object.keys(PLAN_PRICE_ENV_VARS) as PaidPlanId[]) {
    for (const period of ['monthly', 'yearly'] as BillingPeriod[]) {
      const priceId = process.env[PLAN_PRICE_ENV_VARS[planId][period]]?.trim();
      if (priceId) {
        map[priceId] = planId;
      }
    }
  }

  return map;
}

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() ?? '';
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey());
}

export function getStripeClient() {
  const secretKey = getStripeSecretKey();

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set.');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

export function getAppBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3000'
  );
}

function getConfiguredProductOrPriceId() {
  const priceId =
    process.env.STRIPE_PRO_PRICE_ID?.trim() ||
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID?.trim();
  const productId = process.env.STRIPE_PRO_PRODUCT_ID?.trim();

  if (priceId) {
    return priceId.startsWith('prod_')
      ? { productId: priceId, priceId: null as string | null }
      : { productId: null as string | null, priceId };
  }

  if (productId) {
    return { productId, priceId: null as string | null };
  }

  return { productId: null, priceId: null };
}

async function resolvePriceIdFromProduct(productId: string) {
  const stripe = getStripeClient();
  const product = await stripe.products.retrieve(productId);

  if (product.default_price) {
    return typeof product.default_price === 'string'
      ? product.default_price
      : product.default_price.id;
  }

  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 20,
  });

  const monthly =
    prices.data.find(
      (price) =>
        price.recurring?.interval === 'month' && price.type === 'recurring',
    ) ?? prices.data.find((price) => price.type === 'recurring');

  if (!monthly) {
    throw new Error(
      `No active recurring price found for product ${productId}. Add a monthly price in Stripe.`,
    );
  }

  return monthly.id;
}

/** Resolve the Checkout price ID from STRIPE_PRO_PRICE_ID or STRIPE_PRO_PRODUCT_ID. */
export async function resolveStripeProPriceId() {
  const { priceId, productId } = getConfiguredProductOrPriceId();

  if (priceId) {
    return priceId;
  }

  if (productId) {
    return resolvePriceIdFromProduct(productId);
  }

  throw new Error(
    'Set STRIPE_PRO_PRICE_ID (price_...) or STRIPE_PRO_PRODUCT_ID (prod_...) in your environment.',
  );
}

export function formatStripePrice(price: Stripe.Price) {
  if (price.unit_amount == null) {
    return 'Custom pricing';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
  }).format(price.unit_amount / 100);
}

export function formatBillingInterval(price: Stripe.Price) {
  const interval = price.recurring?.interval;
  if (!interval) return null;

  const count = price.recurring?.interval_count ?? 1;
  if (count === 1) {
    return interval === 'month' ? 'month' : interval;
  }

  return `${count} ${interval}s`;
}

export async function fetchProPlanInfo(): Promise<ProPlanInfo> {
  if (!isStripeConfigured()) {
    return {
      configured: false,
      priceId: null,
      productId: null,
      formattedPrice: null,
      intervalLabel: null,
      displayMonthlyPrice: null,
      mode: null,
      configError: 'STRIPE_SECRET_KEY is not set.',
    };
  }

  const configured = getConfiguredProductOrPriceId();

  if (!configured.priceId && !configured.productId) {
    return {
      configured: false,
      priceId: null,
      productId: null,
      formattedPrice: null,
      intervalLabel: null,
      displayMonthlyPrice: null,
      mode: null,
      configError:
        'Set STRIPE_PRO_PRICE_ID (price_...) or STRIPE_PRO_PRODUCT_ID (prod_...) in your environment.',
    };
  }

  try {
    const stripe = getStripeClient();
    const priceId = await resolveStripeProPriceId();
    const price = await stripe.prices.retrieve(priceId, {
      expand: ['product'],
    });

    const product =
      typeof price.product === 'string'
        ? await stripe.products.retrieve(price.product)
        : price.product;

    if (product.deleted) {
      throw new Error('Stripe product was deleted.');
    }

    if (!price.active) {
      throw new Error(`Stripe price ${priceId} is not active.`);
    }

    return {
      configured: true,
      priceId,
      productId: product.id,
      formattedPrice: formatStripePrice(price),
      intervalLabel: formatBillingInterval(price),
      displayMonthlyPrice:
        price.unit_amount != null ? price.unit_amount / 100 : null,
      mode: price.livemode ? 'live' : 'test',
      configError: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Stripe configuration error.';
    return {
      configured: false,
      priceId: configured.priceId,
      productId: configured.productId,
      formattedPrice: null,
      intervalLabel: null,
      displayMonthlyPrice: null,
      mode: null,
      configError: message,
    };
  }
}

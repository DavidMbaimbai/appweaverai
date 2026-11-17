import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPlanIdsByPriceId,
  matchesProSeatTierPrice,
  resolvePriceIdForPlan,
} from './stripe';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Pro seat-tier checkout prices', () => {
  it('resolves the selected tier price instead of the base Pro price', () => {
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_base');
    vi.stubEnv('STRIPE_PRO_100_MONTHLY_PRICE_ID', 'price_pro_100_monthly');

    expect(resolvePriceIdForPlan('pro', 'monthly', 100)).toBe(
      'price_pro_100_monthly',
    );
  });

  it('does not fall back to the base Pro price when a tier price is missing', () => {
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_base');
    vi.stubEnv('STRIPE_PRO_100_MONTHLY_PRICE_ID', '');

    expect(() => resolvePriceIdForPlan('pro', 'monthly', 100)).toThrow(
      'STRIPE_PRO_100_MONTHLY_PRICE_ID',
    );
  });

  it('rejects unsupported seat tiers', () => {
    expect(() => resolvePriceIdForPlan('pro', 'monthly', 101)).toThrow(
      'supported Pro seat tier',
    );
  });

  it('recognizes seat-tier price IDs when syncing subscriptions', () => {
    vi.stubEnv('STRIPE_PRO_100_YEARLY_PRICE_ID', 'price_pro_100_yearly');

    expect(getPlanIdsByPriceId()).toMatchObject({
      price_pro_100_yearly: 'pro',
    });
  });

  it('only accepts Stripe prices that match the selected total and billing period', () => {
    expect(
      matchesProSeatTierPrice(
        {
          active: true,
          unitAmount: 10000,
          currency: 'usd',
          interval: 'month',
          intervalCount: 1,
        },
        100,
        'monthly',
      ),
    ).toBe(true);

    expect(
      matchesProSeatTierPrice(
        {
          active: true,
          unitAmount: 108000,
          currency: 'usd',
          interval: 'year',
          intervalCount: 1,
        },
        100,
        'yearly',
      ),
    ).toBe(true);

    expect(
      matchesProSeatTierPrice(
        {
          active: true,
          unitAmount: 90000,
          currency: 'usd',
          interval: 'year',
          intervalCount: 1,
        },
        100,
        'yearly',
      ),
    ).toBe(false);
  });
});

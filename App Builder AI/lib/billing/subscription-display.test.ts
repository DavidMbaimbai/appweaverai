import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

import {
  buildFallbackSubscriptionDisplayInfo,
  buildSubscriptionDisplayInfo,
  getSubscriptionPeriodEnd,
  isSubscriptionScheduledToCancel,
} from '@/lib/billing/subscription-display';

function makeSubscription(
  overrides: Partial<Stripe.Subscription>,
): Stripe.Subscription {
  return {
    id: 'sub_123',
    status: 'active',
    cancel_at: null,
    cancel_at_period_end: false,
    cancellation_details: null,
    items: { data: [] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

const FUTURE_TS = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
const PAST_TS = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;

describe('getSubscriptionPeriodEnd', () => {
  it('prefers cancel_at when present', () => {
    const sub = makeSubscription({ cancel_at: FUTURE_TS });
    expect(getSubscriptionPeriodEnd(sub)?.getTime()).toBe(FUTURE_TS * 1000);
  });

  it('falls back to the max current_period_end across items', () => {
    const sub = makeSubscription({
      items: {
        data: [
          { current_period_end: FUTURE_TS - 1000 },
          { current_period_end: FUTURE_TS },
        ],
      } as unknown as Stripe.Subscription['items'],
    });
    expect(getSubscriptionPeriodEnd(sub)?.getTime()).toBe(FUTURE_TS * 1000);
  });

  it('returns null when there are no items and no cancel_at', () => {
    const sub = makeSubscription({});
    expect(getSubscriptionPeriodEnd(sub)).toBeNull();
  });
});

describe('isSubscriptionScheduledToCancel', () => {
  it('is true when cancel_at_period_end is set', () => {
    expect(isSubscriptionScheduledToCancel(makeSubscription({ cancel_at_period_end: true }))).toBe(
      true,
    );
  });

  it('is false for a canceled subscription with no explicit cancel flags', () => {
    expect(
      isSubscriptionScheduledToCancel(makeSubscription({ status: 'canceled' })),
    ).toBe(false);
  });

  it('is true when cancel_at is set in the future while active', () => {
    expect(
      isSubscriptionScheduledToCancel(
        makeSubscription({ status: 'active', cancel_at: FUTURE_TS }),
      ),
    ).toBe(true);
  });

  it('is false when cancel_at is in the past', () => {
    expect(
      isSubscriptionScheduledToCancel(
        makeSubscription({ status: 'active', cancel_at: PAST_TS }),
      ),
    ).toBe(false);
  });

  it('is true when cancellation_details reason is cancellation_requested', () => {
    expect(
      isSubscriptionScheduledToCancel(
        makeSubscription({
          status: 'active',
          cancellation_details: { reason: 'cancellation_requested' } as never,
        }),
      ),
    ).toBe(true);
  });
});

describe('buildSubscriptionDisplayInfo', () => {
  it('reports a canceled variant for status=canceled', () => {
    const info = buildSubscriptionDisplayInfo(makeSubscription({ status: 'canceled' }));
    expect(info.variant).toBe('canceled');
    expect(info.summary).toBe('Canceled');
  });

  it('reports a canceling variant with a period-end label when scheduled to cancel', () => {
    const info = buildSubscriptionDisplayInfo(
      makeSubscription({ status: 'active', cancel_at_period_end: true, cancel_at: FUTURE_TS }),
    );
    expect(info.variant).toBe('canceling');
    expect(info.summary).toMatch(/Cancels on/);
  });

  it('reports an active variant for an active subscription with no cancellation', () => {
    const info = buildSubscriptionDisplayInfo(makeSubscription({ status: 'active' }));
    expect(info.variant).toBe('active');
    expect(info.summary).toBe('Active');
  });

  it('reports a past_due variant', () => {
    const info = buildSubscriptionDisplayInfo(makeSubscription({ status: 'past_due' }));
    expect(info.variant).toBe('past_due');
  });

  it('reports an inactive variant for unrecognized statuses', () => {
    const info = buildSubscriptionDisplayInfo(
      makeSubscription({ status: 'incomplete' }),
    );
    expect(info.variant).toBe('inactive');
  });
});

describe('buildFallbackSubscriptionDisplayInfo', () => {
  it('treats "active" as the active variant', () => {
    expect(buildFallbackSubscriptionDisplayInfo('active').variant).toBe('active');
  });

  it('treats "trialing" as the active variant', () => {
    expect(buildFallbackSubscriptionDisplayInfo('trialing').variant).toBe('active');
  });

  it('treats anything else as inactive', () => {
    expect(buildFallbackSubscriptionDisplayInfo('past_due').variant).toBe('inactive');
  });
});

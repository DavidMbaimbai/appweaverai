import type Stripe from 'stripe';

export type SubscriptionDisplayInfo = {
  status: string;
  cancelAtPeriodEnd: boolean;
  periodEndLabel: string | null;
  summary: string;
  variant: 'active' | 'canceling' | 'canceled' | 'past_due' | 'inactive';
  badgeLabel: string;
  badgeClassName: string;
  bannerClassName: string;
  bannerTextClassName: string;
};

const SUBSCRIPTION_VARIANT_STYLES: Record<
  SubscriptionDisplayInfo['variant'],
  {
    badgeLabel: string;
    badgeClassName: string;
    bannerClassName: string;
    bannerTextClassName: string;
  }
> = {
  active: {
    badgeLabel: 'Active',
    badgeClassName: 'bg-emerald-500/20 text-emerald-200',
    bannerClassName: 'border-emerald-500/30 bg-emerald-500/10',
    bannerTextClassName: 'text-emerald-200',
  },
  canceling: {
    badgeLabel: 'Canceling',
    badgeClassName: 'bg-amber-500/20 text-amber-100',
    bannerClassName: 'border-amber-500/30 bg-amber-500/10',
    bannerTextClassName: 'text-amber-100',
  },
  past_due: {
    badgeLabel: 'Payment due',
    badgeClassName: 'bg-red-500/20 text-red-200',
    bannerClassName: 'border-red-500/30 bg-red-500/10',
    bannerTextClassName: 'text-red-200',
  },
  canceled: {
    badgeLabel: 'Canceled',
    badgeClassName: 'bg-app-surface-active text-app-text-muted',
    bannerClassName: 'border-app-border-subtle bg-app-surface-active/60',
    bannerTextClassName: 'text-app-text-secondary',
  },
  inactive: {
    badgeLabel: 'Inactive',
    badgeClassName: 'bg-app-surface-active text-app-text-muted',
    bannerClassName: 'border-app-border-subtle bg-app-surface-active/60',
    bannerTextClassName: 'text-app-text-secondary',
  },
};

function formatSubscriptionDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function withDisplayStyles(
  info: Omit<
    SubscriptionDisplayInfo,
    'badgeLabel' | 'badgeClassName' | 'bannerClassName' | 'bannerTextClassName'
  >,
): SubscriptionDisplayInfo {
  const styles = SUBSCRIPTION_VARIANT_STYLES[info.variant];
  return {
    ...info,
    ...styles,
  };
}

export function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  if (subscription.cancel_at) {
    return new Date(subscription.cancel_at * 1000);
  }

  const items = subscription.items?.data ?? [];
  if (items.length === 0) {
    return null;
  }

  const periodEndTs = Math.max(...items.map((item) => item.current_period_end));
  return new Date(periodEndTs * 1000);
}

export function isSubscriptionScheduledToCancel(
  subscription: Stripe.Subscription,
) {
  if (subscription.cancel_at_period_end) {
    return true;
  }

  const status = subscription.status;
  if (status !== 'active' && status !== 'trialing') {
    return false;
  }

  if (
    subscription.cancel_at != null &&
    subscription.cancel_at * 1000 > Date.now()
  ) {
    return true;
  }

  if (subscription.cancellation_details?.reason === 'cancellation_requested') {
    return true;
  }

  return false;
}

export function buildSubscriptionDisplayInfo(
  subscription: Stripe.Subscription,
): SubscriptionDisplayInfo {
  const status = subscription.status;
  const cancelAtPeriodEnd = isSubscriptionScheduledToCancel(subscription);
  const periodEnd = getSubscriptionPeriodEnd(subscription);
  const periodEndLabel = periodEnd ? formatSubscriptionDate(periodEnd) : null;

  if (status === 'canceled' || status === 'incomplete_expired') {
    return withDisplayStyles({
      status,
      cancelAtPeriodEnd,
      periodEndLabel,
      summary: periodEndLabel
        ? `Canceled — access ended ${periodEndLabel}`
        : 'Canceled',
      variant: 'canceled',
    });
  }

  if (cancelAtPeriodEnd && periodEndLabel) {
    return withDisplayStyles({
      status,
      cancelAtPeriodEnd: true,
      periodEndLabel,
      summary: `Cancels on ${periodEndLabel} — you keep Pro until then`,
      variant: 'canceling',
    });
  }

  if (cancelAtPeriodEnd) {
    return withDisplayStyles({
      status,
      cancelAtPeriodEnd: true,
      periodEndLabel: null,
      summary: 'Scheduled to cancel at the end of the billing period',
      variant: 'canceling',
    });
  }

  if (status === 'active' || status === 'trialing') {
    return withDisplayStyles({
      status,
      cancelAtPeriodEnd: false,
      periodEndLabel,
      summary: periodEndLabel
        ? `Active — renews on ${periodEndLabel}`
        : 'Active',
      variant: 'active',
    });
  }

  if (status === 'past_due' || status === 'unpaid') {
    return withDisplayStyles({
      status,
      cancelAtPeriodEnd,
      periodEndLabel,
      summary: periodEndLabel
        ? `Payment issue — update billing by ${periodEndLabel}`
        : 'Payment issue — update your billing details',
      variant: 'past_due',
    });
  }

  return withDisplayStyles({
    status,
    cancelAtPeriodEnd,
    periodEndLabel,
    summary: status.replaceAll('_', ' '),
    variant: 'inactive',
  });
}

export function buildFallbackSubscriptionDisplayInfo(
  subscriptionStatus: string,
): SubscriptionDisplayInfo {
  const isActive =
    subscriptionStatus === 'active' || subscriptionStatus === 'trialing';

  return withDisplayStyles({
    status: subscriptionStatus,
    cancelAtPeriodEnd: false,
    periodEndLabel: null,
    summary: isActive
      ? `Active (${subscriptionStatus})`
      : subscriptionStatus.replaceAll('_', ' '),
    variant: isActive ? 'active' : 'inactive',
  });
}

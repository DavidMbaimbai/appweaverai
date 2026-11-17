'use client';

import { proSeatTiers } from '@/lib/landing-data';
import type { BillingPeriod } from '@/lib/types';

export function ProSeatSelect({
  period,
  value,
  onChange,
}: {
  period: BillingPeriod;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-3 w-full rounded-xl border border-border-light bg-surface-white px-3 py-2.5 text-sm text-text-primary"
      aria-label="Pro seat tier"
      suppressHydrationWarning>
      {proSeatTiers.map((tier) => {
        const price = period === 'yearly' ? tier.yearly : tier.monthly;
        const billingLabel =
          period === 'yearly' ? 'billed annually' : 'billed monthly';

        return (
          <option key={tier.seats} value={tier.seats}>
            {tier.seats} seats - ${price} / month, {billingLabel}
          </option>
        );
      })}
    </select>
  );
}

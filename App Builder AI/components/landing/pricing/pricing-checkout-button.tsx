'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { useAuthModal } from '@/components/auth/auth-modal-provider';
import { createPlanCheckoutSessionAction } from '@/lib/actions/billing';
import type { PaidPlanId } from '@/lib/stripe';
import type { BillingPeriod } from '@/lib/types';
import { cn } from '@/lib/utils';

type PricingCheckoutButtonProps = {
  planId: PaidPlanId;
  period: BillingPeriod;
  label: string;
  className: string;
};

/**
 * CTA for the paid pricing tiers (Builder/Pro/Business) that goes straight to
 * Stripe Checkout instead of the generic /app/billing screen. Signed-out
 * visitors are sent through sign-up/login first — their intended plan is
 * carried via the `callbackUrl`, and /app/billing auto-starts checkout for
 * that plan once they land there authenticated (see billing-page-client.tsx).
 */
export function PricingCheckoutButton({
  planId,
  period,
  label,
  className,
}: PricingCheckoutButtonProps) {
  const { data: session, isPending } = authClient.useSession();
  const { openAuthModal } = useAuthModal();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (isPending || isLoading) return;
    setError(null);

    const upgradeCallback = `/app/billing?upgrade=${planId}&period=${period}`;

    if (!session?.user) {
      const params = new URLSearchParams(window.location.search);
      params.set('auth', 'register');
      params.set('callbackUrl', upgradeCallback);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?${params.toString()}`,
      );
      openAuthModal('register');
      return;
    }

    setIsLoading(true);
    void createPlanCheckoutSessionAction(planId, period).then((result) => {
      if (result?.url) {
        window.location.assign(result.url);
        return;
      }
      setIsLoading(false);
      setError(result?.error ?? 'Could not start checkout.');
    });
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className={cn(className, isLoading && 'cursor-not-allowed opacity-70')}>
        {isLoading ? 'Redirecting…' : label}
      </button>
      {error ? (
        <p className="text-center text-xs text-red-500">{error}</p>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { estimateCreditsAction } from '@/lib/actions/credit-controls';
import type { CreditEstimate } from '@/lib/credits/estimate';
import type { CreditOperation } from '@/lib/credits/pricing';

/** Shows the estimated credit cost of an operation before the user runs it. */
export function CreditEstimateHint({
  operation,
  seconds,
  workspaceId,
  className,
}: {
  operation: CreditOperation;
  seconds?: number;
  workspaceId?: string | null;
  className?: string;
}) {
  const [estimate, setEstimate] = useState<CreditEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    estimateCreditsAction(operation, { seconds, workspaceId })
      .then((value) => {
        if (!cancelled) setEstimate(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [operation, seconds, workspaceId]);

  if (!estimate) return null;
  return (
    <p className={className ?? 'text-xs text-app-text-muted'} data-testid="credit-estimate">
      {estimate.summary}. {estimate.disclaimer}
      {estimate.metered ? ` Balance after: about ${Math.max(0, estimate.balanceAfter)} credits.` : ''}
      {estimate.blocked ? <span className="ml-1 text-amber-400">{estimate.blocked.message}</span> : null}
    </p>
  );
}

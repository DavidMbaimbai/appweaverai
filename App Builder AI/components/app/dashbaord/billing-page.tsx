import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { BillingPageClient } from '@/components/app/billing/billing-page-client';
import { EmptyState } from '@/components/ui/empty-state';
import { syncBillingAfterCheckoutAction } from '@/lib/actions/billing';
import { getCachedSession } from '@/lib/auth/cached';
import { getBillingPageData } from '@/lib/queries/billing';

type BillingPageProps = {
  searchParams: Promise<{
    checkout?: string;
    session_id?: string;
    upgraded?: string;
  }>;
};

export async function BillingPage({ searchParams }: BillingPageProps) {
  const session = await getCachedSession();

  if (!session?.user?.id) {
    redirect('/?auth=login&callbackUrl=/app/billing');
  }

  const params = await searchParams;

  if (params.checkout === 'success' && params.upgraded !== '1') {
    const sessionId = params.session_id?.trim();

    if (!sessionId || !sessionId.startsWith('cs_')) {
      redirect('/app/billing?checkout=invalid');
    }

    const syncResult = await syncBillingAfterCheckoutAction(sessionId);

    if ('error' in syncResult && syncResult.error) {
      redirect('/app/billing?checkout=invalid');
    }

    redirect('/app/billing?upgraded=1');
  }

  const billing = await getBillingPageData();

  if (!billing) {
    return (
      <div className="flex w-full flex-1 items-center justify-center px-6 py-8">
        <EmptyState
          theme="app"
          className="max-w-md"
          title="Billing unavailable"
          description="Connect a database and Stripe keys to manage subscriptions."
        />
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <BillingPageClient
        plan={billing.plan}
        status={billing.status}
        hasCustomer={billing.hasCustomer}
        proPlan={billing.proPlan}
        subscription={billing.subscription}
        justUpgraded={params.upgraded === '1'}
      />
    </Suspense>
  );
}

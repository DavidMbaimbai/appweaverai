import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PaymentFailedBanner } from '@/components/app/billing/payment-failed-banner';
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
    <>
      <div className="mx-auto w-full max-w-app-content space-y-3 px-4 pt-4 tablet-up:px-8">
        <PaymentFailedBanner userId={session.user.id} />
        <p className="flex gap-4 text-sm">
          <Link href="/app/billing/invoices" className="font-medium text-appweaver-orange">Invoices & receipts →</Link>
          <Link href="/app/billing/transactions" className="font-medium text-appweaver-orange">Credit transactions →</Link>
        </p>
      </div>
      <Suspense fallback={null}>
        <BillingPageClient
          plan={billing.plan}
          status={billing.status}
          hasCustomer={billing.hasCustomer}
          creditBalance={billing.creditBalance}
          proPlan={billing.proPlan}
          subscription={billing.subscription}
          justUpgraded={params.upgraded === '1'}
        />
      </Suspense>
    </>
  );
}

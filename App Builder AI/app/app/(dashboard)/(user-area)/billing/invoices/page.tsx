import Link from 'next/link';

import { PaymentFailedBanner } from '@/components/app/billing/payment-failed-banner';
import { PageHeader } from '@/components/app/shell/page-header';
import { getCachedSession } from '@/lib/auth/cached';
import { loadCustomerInvoices } from '@/lib/billing/invoices';

export const dynamic = 'force-dynamic';

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export default async function InvoicesPage() {
  const userId = (await getCachedSession())?.user?.id;
  const data = userId && process.env.DATABASE_URL ? await loadCustomerInvoices(userId) : null;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Invoices & receipts" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-6 px-4 py-6 tablet-up:px-8">
        {!userId || !data ? (
          <p className="text-sm text-app-text-muted">Sign in to see your invoices.</p>
        ) : (
          <>
            <PaymentFailedBanner userId={userId} />
            {data.refreshError ? <p className="text-xs text-amber-400">{data.refreshError}</p> : null}
            <section>
              <h2 className="mb-2 text-sm font-medium text-app-text">Subscription invoices</h2>
              {data.invoices.length === 0 ? (
                <p className="text-sm text-app-text-muted">No invoices yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-app-border-subtle">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-app-surface text-xs uppercase text-app-text-muted">
                      <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Download</th></tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((i) => (
                        <tr key={i.id} className="border-t border-app-border-subtle text-app-text">
                          <td className="px-3 py-2">{i.stripeCreatedAt.toLocaleDateString('en-GB')}</td>
                          <td className="px-3 py-2">{i.number ?? i.id}{i.billingReason === 'subscription_update' ? ' (plan change, prorated)' : ''}</td>
                          <td className="px-3 py-2">{money(i.amountDueCents, i.currency)}</td>
                          <td className="px-3 py-2 capitalize">{i.status}</td>
                          <td className="space-x-3 px-3 py-2">
                            {i.hostedInvoiceUrl ? <a className="underline" href={i.hostedInvoiceUrl} target="_blank" rel="noreferrer">View</a> : null}
                            {i.invoicePdfUrl ? <a className="underline" href={i.invoicePdfUrl} target="_blank" rel="noreferrer">PDF</a> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-app-text-muted">
                Changing plan mid-cycle is prorated by Stripe: you are credited for unused time on the old plan and
                charged for the remainder of the cycle on the new one, shown as a separate invoice line.{' '}
                <Link href="/app/billing" className="underline">Change, cancel or resume your plan</Link>.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-medium text-app-text">Marketing credit purchases</h2>
              {data.receipts.length === 0 ? (
                <p className="text-sm text-app-text-muted">No purchases yet.</p>
              ) : (
                <ul className="space-y-1 text-sm text-app-text">
                  {data.receipts.map((r) => (
                    <li key={r.id}>
                      {r.createdAt.toLocaleDateString('en-GB')}: {r.packageName} ({r.credits} credits), {money(r.amountCents, r.currency)}{' '}
                      {r.receiptUrl ? <a className="underline" href={r.receiptUrl} target="_blank" rel="noreferrer">Receipt</a> : <span className="text-app-text-muted">receipt not available</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

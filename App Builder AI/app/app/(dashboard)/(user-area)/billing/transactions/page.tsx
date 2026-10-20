import Link from 'next/link';

import { PageHeader } from '@/components/app/shell/page-header';
import { getCachedSession } from '@/lib/auth/cached';
import { KIND_LABELS, loadUnifiedLedger } from '@/lib/credits/unified-ledger';

export const dynamic = 'force-dynamic';

export default async function TransactionsPage() {
  const userId = (await getCachedSession())?.user?.id;
  const entries = userId && process.env.DATABASE_URL ? await loadUnifiedLedger(userId, { limit: 300 }) : null;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Credit transactions" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-4 px-4 py-6 tablet-up:px-8">
        {!entries ? (
          <p className="text-sm text-app-text-muted">Sign in to see your transactions.</p>
        ) : (
          <>
            <p className="text-sm text-app-text-secondary">
              Development and marketing credits are separate wallets. Each line shows whether credits were purchased,
              promotional, part of your subscription allowance, spent, refunded or adjusted.
            </p>
            {/* File download from a route handler, not a page. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/billing/transactions/export" className="inline-block text-sm font-medium text-appweaver-orange">
              Download CSV
            </a>
            {entries.length === 0 ? (
              <p className="text-sm text-app-text-muted">No transactions yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-app-border-subtle">
                <table className="w-full text-left text-sm">
                  <thead className="bg-app-surface text-xs uppercase text-app-text-muted">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Wallet</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Credits</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={`${e.wallet}:${e.id}`} className="border-t border-app-border-subtle text-app-text">
                        <td className="whitespace-nowrap px-3 py-2">{e.createdAt.toLocaleString('en-GB')}</td>
                        <td className="px-3 py-2">{e.wallet === 'DEVELOPMENT' ? 'Development' : 'Marketing'}</td>
                        <td className="px-3 py-2">{KIND_LABELS[e.kind]}</td>
                        <td className="px-3 py-2">{e.description}</td>
                        <td className="px-3 py-2 text-right">{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                        <td className="px-3 py-2 text-right">{e.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Link href="/app/usage" className="text-sm underline">Back to usage</Link>
          </>
        )}
      </div>
    </main>
  );
}

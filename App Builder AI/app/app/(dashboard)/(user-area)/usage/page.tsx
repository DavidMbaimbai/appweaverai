import Link from 'next/link';

import { PageHeader } from '@/components/app/shell/page-header';
import { getCachedSession } from '@/lib/auth/cached';
import { CREDIT_OPERATION_LABELS, quote, type CreditOperation } from '@/lib/credits/pricing';
import { getCreditsOverview } from '@/lib/credits/queries';

export const dynamic = 'force-dynamic';

const PRICED: CreditOperation[] = ['agent_run', 'studio_text', 'launch_kit', 'design_import', 'review_ai'];

export default async function UsagePage() {
  const userId = (await getCachedSession())?.user?.id;
  const overview = userId && process.env.DATABASE_URL ? await getCreditsOverview(userId) : null;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Usage & credits" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-8 px-4 py-6 tablet-up:px-8">
        {!overview ? (
          <p className="text-sm text-app-text-muted">Sign in to see your credits.</p>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
                <p className="text-xs uppercase tracking-wide text-app-text-muted">Balance</p>
                <p className="text-3xl font-semibold text-app-text">{overview.balance}</p>
                <p className="text-xs text-app-text-muted">credits</p>
              </div>
              <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
                <p className="text-xs uppercase tracking-wide text-app-text-muted">Plan</p>
                <p className="text-xl font-semibold capitalize text-app-text">{overview.plan}</p>
                <p className="text-xs text-app-text-muted">
                  {overview.monthlyAllowance
                    ? `${overview.monthlyAllowance} credits per month${
                        overview.renewsAt ? `, renews ${overview.renewsAt.toLocaleDateString('en-GB')}` : ''
                      }`
                    : 'Free plan: daily usage limits apply, no credits are charged.'}
                </p>
              </div>
              <div className="flex items-center rounded-xl border border-app-border-subtle bg-app-surface p-4">
                <Link href="/app/billing" className="text-sm font-medium text-appweaver-orange">
                  {overview.metered ? 'Top up or change plan →' : 'Upgrade for more credits →'}
                </Link>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-medium text-app-text">What things cost</h2>
              <ul className="grid gap-1 text-sm text-app-text-secondary sm:grid-cols-2">
                {PRICED.map((op) => (
                  <li key={op}>
                    {CREDIT_OPERATION_LABELS[op]}: {quote(op).credits} credits
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-app-text-muted">
                Marketing actions (posts, images, video, ads) use separate{' '}
                <Link href="/app/marketing-credits" className="underline">marketing credits</Link>.
              </p>
              <p className="mt-2 text-xs text-app-text-muted">
                Credits cover AppWeaver AI work only. Ad spend paid to Meta, SMS and phone calls are billed
                separately and are never taken from your credits. Failed actions are refunded automatically.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-medium text-app-text">Recent activity</h2>
              {overview.entries.length === 0 ? (
                <p className="text-sm text-app-text-muted">No credit activity yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-app-border-subtle">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-app-surface text-xs uppercase text-app-text-muted">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2 text-right">Credits</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.entries.map((entry) => (
                        <tr key={entry.id} className="border-t border-app-border-subtle text-app-text">
                          <td className="whitespace-nowrap px-3 py-2">
                            {entry.createdAt.toLocaleString('en-GB')}
                          </td>
                          <td className="px-3 py-2">{entry.reason}</td>
                          <td className="px-3 py-2 text-right">
                            {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                          </td>
                          <td className="px-3 py-2 text-right">{entry.balanceAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

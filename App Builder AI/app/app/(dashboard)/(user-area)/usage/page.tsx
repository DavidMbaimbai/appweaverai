import Link from 'next/link';

import { PageHeader } from '@/components/app/shell/page-header';
import { PaymentFailedBanner } from '@/components/app/billing/payment-failed-banner';
import { SpendLimitForm } from '@/components/app/credits/spend-limit-form';
import { markUsageAlertsReadAction } from '@/lib/actions/credit-controls';
import { getCachedSession } from '@/lib/auth/cached';
import { listUnreadAlerts, monthlySpend } from '@/lib/credits/limits';
import { CREDIT_OPERATION_LABELS, quote, type CreditOperation } from '@/lib/credits/pricing';
import { getCreditsOverview } from '@/lib/credits/queries';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PRICED: CreditOperation[] = ['agent_run', 'studio_text', 'launch_kit', 'design_import', 'review_ai'];

async function dismissAlerts() {
  'use server';
  await markUsageAlertsReadAction();
}

export default async function UsagePage() {
  const userId = (await getCachedSession())?.user?.id;
  const overview = userId && process.env.DATABASE_URL ? await getCreditsOverview(userId) : null;
  const controls =
    userId && overview
      ? await Promise.all([
          listUnreadAlerts(userId),
          prisma.creditSpendLimit.findMany({ where: { scope: 'USER', scopeId: userId } }),
          prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true, name: true } }),
          monthlySpend({ userId }),
        ]).then(async ([alerts, userLimits, workspaces, spent]) => {
          const wsLimits = await prisma.creditSpendLimit.findMany({
            where: { scope: 'WORKSPACE', scopeId: { in: workspaces.map((w) => w.id) } },
          });
          return {
            alerts,
            spent,
            userLimit: userLimits[0]?.monthlyLimit ?? null,
            workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, limit: wsLimits.find((l) => l.scopeId === w.id)?.monthlyLimit ?? null })),
          };
        })
      : null;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Usage & credits" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-8 px-4 py-6 tablet-up:px-8">
        {userId ? <PaymentFailedBanner userId={userId} /> : null}
        {controls && controls.alerts.length > 0 ? (
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-app-text">
            <ul className="space-y-1">
              {controls.alerts.map((a) => (
                <li key={a.id}>
                  {a.threshold >= 100 ? 'Reached' : `${a.threshold}% of`} your{' '}
                  {a.scope === 'ALLOWANCE' ? 'monthly plan allowance' : a.scope === 'USER' ? 'monthly spending limit' : 'workspace spending limit'}{' '}
                  ({a.spent} of {a.cap} credits, {a.period}).
                </li>
              ))}
            </ul>
            <form action={dismissAlerts} className="mt-2">
              <button className="text-xs underline">Dismiss</button>
            </form>
          </section>
        ) : null}
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
              <h2 className="mb-1 text-sm font-medium text-app-text">Monthly spending limits</h2>
              <p className="mb-3 text-xs text-app-text-muted">
                Development credits only (marketing credits have their own wallet). New runs are paused once a limit
                would be exceeded; you get an alert at 80% and 100%.
                {controls ? ` Used this month: ${controls.spent} credits.` : ''}
              </p>
              {controls ? <SpendLimitForm userLimit={controls.userLimit} workspaces={controls.workspaces} /> : null}
              <p className="mt-3 flex gap-4 text-sm">
                <Link href="/app/billing/transactions" className="font-medium text-appweaver-orange">All transactions →</Link>
                <Link href="/app/billing/invoices" className="font-medium text-appweaver-orange">Invoices →</Link>
              </p>
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

import { PageHeader } from '@/components/app/shell/page-header';
import { BudgetForm, BuyPackageButton } from '@/components/app/marketing-credits/forms';
import { getCachedSession } from '@/lib/auth/cached';
import { getActivePrices } from '@/lib/marketing-credits/pricing';
import { listActivePackages } from '@/lib/marketing-credits/purchase';
import { getWallet } from '@/lib/marketing-credits/wallet';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export default async function MarketingCreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const userId = (await getCachedSession())?.user?.id;
  const { checkout } = await searchParams;
  if (!userId || !process.env.DATABASE_URL) {
    return (
      <main className="flex flex-1 flex-col overflow-y-auto">
        <PageHeader title="Marketing credits" />
        <p className="p-6 text-sm text-app-text-muted">Sign in to see your marketing credits.</p>
      </main>
    );
  }

  const [wallet, packages, prices, purchases, history, projects, lots] = await Promise.all([
    getWallet(userId),
    listActivePackages(),
    getActivePrices(),
    prisma.marketingPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.marketingLedger.findMany({
      where: { userId, kind: { not: 'RESERVE' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.project.findMany({
      where: { workspace: { ownerId: userId } },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.marketingCreditLot.findMany({
      where: { userId, remaining: { gt: 0 }, expiresAt: { not: null } },
      orderBy: { expiresAt: 'asc' },
      take: 5,
    }),
  ]);
  const budgets = await prisma.marketingProjectBudget.findMany({
    where: { projectId: { in: projects.map((p) => p.id) } },
  });
  const budgetByProject = new Map(budgets.map((b) => [b.projectId, b]));
  const priced = [...prices.values()].filter((p) => p.billable);

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Marketing credits" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-8 px-4 py-6 tablet-up:px-8">
        {checkout === 'success' ? (
          <p className="rounded-md bg-app-surface p-3 text-sm text-app-text">
            Payment received. Credits appear here as soon as Stripe confirms the payment.
          </p>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
            <p className="text-xs uppercase tracking-wide text-app-text-muted">Available</p>
            <p className="text-3xl font-semibold text-app-text">{wallet.available}</p>
            <p className="text-xs text-app-text-muted">marketing credits ({wallet.reserved} reserved for running jobs)</p>
          </div>
          <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4 sm:col-span-2">
            <p className="text-sm text-app-text-secondary">
              Marketing credits pay for posts, images, video, ads copy, translations and follow-ups. They are
              separate from build credits. Ad spend, SMS and calls are billed by the providers, never by credits
              (passthrough messaging is priced at provider cost plus margin).
            </p>
            {lots.length > 0 ? (
              <p className="mt-2 text-xs text-amber-500">
                Expiring: {lots.map((l) => `${l.remaining} on ${l.expiresAt?.toLocaleDateString('en-GB')}`).join(', ')}
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-app-text">Top up</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {packages.map((p) => (
              <div key={p.id} className="space-y-2 rounded-xl border border-app-border-subtle bg-app-surface p-4">
                <p className="font-medium text-app-text">{p.name}</p>
                <p className="text-sm text-app-text-secondary">
                  {p.credits.toLocaleString('en-GB')} credits · {money(p.priceCents, p.currency)}
                </p>
                <BuyPackageButton packageId={p.id} label={`Buy for ${money(p.priceCents, p.currency)}`} />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-app-text">What things cost</h2>
          <ul className="grid gap-1 text-sm text-app-text-secondary sm:grid-cols-2">
            {priced.map((p) => (
              <li key={p.operation}>
                {p.name}: {p.creditCost}
                {p.unit ? ` per ${p.unit}` : ''} credits{p.maxFactor > 1 ? ` (up to ${Math.ceil(p.creditCost * p.maxFactor)})` : ''}
              </li>
            ))}
            <li>Scheduling and publishing: free</li>
          </ul>
        </section>

        {projects.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-app-text">Recurring campaign budgets</h2>
            <p className="text-xs text-app-text-muted">
              Scheduled jobs pause (and you get an email) when a limit or your balance is reached. Leave blank for no limit.
            </p>
            {projects.map((project) => {
              const b = budgetByProject.get(project.id);
              return (
                <BudgetForm
                  key={project.id}
                  projectId={project.id}
                  name={project.name}
                  limits={{ dayLimit: b?.dayLimit ?? null, weekLimit: b?.weekLimit ?? null, monthLimit: b?.monthLimit ?? null }}
                  pausedReason={b?.pausedAt ? (b.pausedReason ?? 'limit reached') : null}
                />
              );
            })}
          </section>
        ) : null}

        <section>
          <h2 className="mb-2 text-sm font-medium text-app-text">Receipts</h2>
          {purchases.length === 0 ? (
            <p className="text-sm text-app-text-muted">No purchases yet.</p>
          ) : (
            <table className="w-full text-left text-sm text-app-text">
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-t border-app-border-subtle">
                    <td className="py-1">{p.createdAt.toLocaleDateString('en-GB')}</td>
                    <td>{p.packageName}</td>
                    <td>{p.credits} credits</td>
                    <td>{money(p.amountCents, p.currency)}</td>
                    <td className="text-xs text-app-text-muted">{p.stripeSessionId.slice(-10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-app-text">History</h2>
          <table className="w-full text-left text-sm text-app-text">
            <thead className="text-xs text-app-text-muted">
              <tr><th>When</th><th>Type</th><th>Operation</th><th>Credits</th><th>Balance</th></tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t border-app-border-subtle">
                  <td className="py-1">{row.createdAt.toLocaleString('en-GB')}</td>
                  <td>{row.kind.toLowerCase()}</td>
                  <td>{row.operation ?? row.note ?? ''}</td>
                  <td>{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
                  <td>{row.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

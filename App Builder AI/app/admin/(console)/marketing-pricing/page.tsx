import { AdminPageHeader, formatDateTime } from '@/components/admin/ui/primitives';
import { createPriceVersionAction, savePackageAction, seedPricesAction, approveCatalogueAction, saveFreeAllowanceAction } from '@/lib/admin/actions/marketing';
import { requireAdmin } from '@/lib/auth/require-admin';
import { DEFAULT_PACKAGES } from '@/lib/marketing-credits/purchase';
import { getApproval, getFreeAllowance } from '@/lib/marketing-credits/settings';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const input = 'rounded-md border border-app-border-subtle bg-app-bg px-2 py-1 text-sm text-app-text';
const button = 'rounded-md bg-app-text px-3 py-1 text-sm font-medium text-app-bg';

export default async function MarketingPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return null;
  const { notice } = await searchParams;

  const items = await prisma.marketingPriceItem.findMany({ orderBy: [{ operation: 'asc' }, { version: 'desc' }] });
  const [{ approved, approval }, allowance] = await Promise.all([getApproval(), getFreeAllowance()]);
  const packages = await prisma.marketingPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  const latest = new Map<string, (typeof items)[number]>();
  for (const item of items) if (!latest.has(item.operation)) latest.set(item.operation, item);

  return (
    <>
      <AdminPageHeader
        title="Marketing pricing"
        description="Versioned price catalogue for marketing credits. Saving creates a new version; older versions are kept. Scheduling and publishing are free by default."
      />
      {notice ? <p className="mb-4 rounded-md bg-app-surface p-3 text-sm text-app-text">{notice}</p> : null}
      <div className="space-y-8">
        <section className="space-y-3 rounded-xl border border-app-border-subtle bg-app-surface p-4">
          {approved && approval ? (
            <p className="text-sm text-app-text">
              Catalogue approved by {approval.approvedByEmail} on {formatDateTime(new Date(approval.approvedAt))}. Any price or
              package change voids the approval.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-amber-500">Unapproved defaults</p>
              <p className="text-xs text-app-text-muted">
                Every price, package, threshold, refund rule and reservation TTL is an unapproved assumption (see
                docs/marketing-credits-pricing.md). Customer package purchases are blocked until an admin approves this
                catalogue version{process.env.MARKETING_CREDITS_ALLOW_UNAPPROVED === 'true' ? ' (currently overridden by MARKETING_CREDITS_ALLOW_UNAPPROVED)' : ''}.
              </p>
              <form action={approveCatalogueAction}>
                <button className={button}>Mark current catalogue approved</button>
              </form>
            </>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-medium text-app-text">Free-plan trial allowance</h2>
          <p className="text-xs text-app-text-muted">
            Promotional credits granted to free-plan customers, separate from purchased credits. 0 = disabled (the default).
            Never applied to AppWeaver internal scope.
          </p>
          <form
            action={saveFreeAllowanceAction}
            className="grid items-end gap-2 rounded-xl border border-app-border-subtle bg-app-surface p-4 sm:grid-cols-5">
            <label className="text-xs text-app-text-muted">
              Credits per grant
              <input name="credits" type="number" min={0} defaultValue={allowance.credits} className={`${input} w-full`} />
            </label>
            <label className="text-xs text-app-text-muted">
              Frequency
              <select name="mode" defaultValue={allowance.mode} className={`${input} w-full`}>
                <option value="ONCE">One-time</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <label className="text-xs text-app-text-muted">
              Expires after (days, blank = never)
              <input name="expiryDays" type="number" min={1} defaultValue={allowance.expiryDays ?? ''} className={`${input} w-full`} />
            </label>
            <label className="text-xs text-app-text-muted">
              Reason
              <input name="reason" className={`${input} w-full`} />
            </label>
            <button className={button}>Save allowance</button>
          </form>
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium text-app-text">Price items</h2>
            <form action={seedPricesAction}>
              <button className={button}>Seed missing defaults</button>
            </form>
          </div>
          {latest.size === 0 ? (
            <p className="text-sm text-app-text-muted">
              No rows yet: code defaults are in effect. Seed them to start versioning.
            </p>
          ) : null}
          {[...latest.values()].map((item) => (
            <form
              key={item.id}
              action={createPriceVersionAction}
              className="grid items-end gap-2 rounded-xl border border-app-border-subtle bg-app-surface p-4 sm:grid-cols-6">
              <input type="hidden" name="operation" value={item.operation} />
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-app-text">
                  {item.name} <span className="text-app-text-muted">({item.operation}, v{item.version})</span>
                </p>
                <p className="text-xs text-app-text-muted">
                  {item.description} Effective {formatDateTime(item.effectiveFrom)}
                  {item.provider ? ` · ${item.provider}` : ''}
                  {item.costCents != null ? ` · cost ${item.costCents}c` : ''}
                </p>
              </div>
              <label className="text-xs text-app-text-muted">
                Credits{item.rule ? ' / unit' : ''}
                <input name="creditCost" type="number" min={0} defaultValue={item.creditCost} className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted">
                Max factor
                <input name="maxFactor" type="number" step="0.05" min={1} max={5} defaultValue={item.maxFactor} className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted">
                Max / month
                <input name="maxPerPeriod" type="number" min={0} defaultValue={item.maxPerPeriod ?? ''} className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted">
                Restricted plans
                <input name="planRestrictions" defaultValue={item.planRestrictions.join(',')} className={`${input} w-full`} />
              </label>
              <label className="flex items-center gap-2 text-xs text-app-text-muted">
                <input name="billable" type="checkbox" defaultChecked={item.billable} /> Billable
              </label>
              <label className="text-xs text-app-text-muted">
                Effective from
                <input name="effectiveFrom" type="datetime-local" className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted sm:col-span-3">
                Reason
                <input name="reason" required className={`${input} w-full`} />
              </label>
              <button className={button}>Save new version</button>
            </form>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-medium text-app-text">Credit packages (Stripe one-off checkout)</h2>
          {packages.length === 0 ? (
            <p className="text-sm text-app-text-muted">
              Using built-in defaults: {DEFAULT_PACKAGES.map((p) => `${p.name} $${(p.priceCents / 100).toFixed(2)}`).join(', ')}.
            </p>
          ) : null}
          {[...packages, null].map((pkg) => (
            <form
              key={pkg?.id ?? 'new'}
              action={savePackageAction}
              className="grid items-end gap-2 rounded-xl border border-app-border-subtle bg-app-surface p-4 sm:grid-cols-6">
              <input type="hidden" name="id" value={pkg?.id ?? ''} />
              <label className="text-xs text-app-text-muted sm:col-span-2">
                {pkg ? 'Name' : 'New package name'}
                <input name="name" defaultValue={pkg?.name ?? ''} className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted">
                Credits
                <input name="credits" type="number" min={1} defaultValue={pkg?.credits ?? ''} className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted">
                Price (cents)
                <input name="priceCents" type="number" min={1} defaultValue={pkg?.priceCents ?? ''} className={`${input} w-full`} />
              </label>
              <label className="text-xs text-app-text-muted">
                Order
                <input name="sortOrder" type="number" min={0} defaultValue={pkg?.sortOrder ?? 0} className={`${input} w-full`} />
              </label>
              <label className="flex items-center gap-2 text-xs text-app-text-muted">
                <input name="active" type="checkbox" defaultChecked={pkg?.active ?? true} /> Active
              </label>
              <button className={button}>{pkg ? 'Save' : 'Add package'}</button>
            </form>
          ))}
        </section>
      </div>
    </>
  );
}

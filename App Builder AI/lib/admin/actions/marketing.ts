'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { isMarketingOperation, seedMarketingPrices } from '@/lib/marketing-credits/pricing';
import { approveCatalogue, getFreeAllowance, saveFreeAllowance } from '@/lib/marketing-credits/settings';
import { grantCredits } from '@/lib/marketing-credits/wallet';
import { prisma } from '@/lib/prisma';

const PRICING = '/admin/marketing-pricing';
const REPORTS = '/admin/marketing-reports';

async function ip() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

function back(path: string, message: string): never {
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function int(value: FormDataEntryValue | null) {
  const n = Number(String(value ?? '').trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** New version row; older versions are kept so past usage can be reconciled. */
export async function createPriceVersionAction(formData: FormData): Promise<void> {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return back(PRICING, 'Not authorized.');
  const operation = String(formData.get('operation') ?? '');
  if (!isMarketingOperation(operation)) return back(PRICING, 'Unknown operation.');
  const creditCost = int(formData.get('creditCost'));
  if (creditCost === null) return back(PRICING, 'Credit cost must be a whole number.');
  const maxFactor = Number(formData.get('maxFactor') ?? 1);
  if (!Number.isFinite(maxFactor) || maxFactor < 1 || maxFactor > 5) return back(PRICING, 'Max factor must be between 1 and 5.');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) return back(PRICING, 'A reason is required.');
  const effectiveRaw = String(formData.get('effectiveFrom') ?? '').trim();
  const effectiveFrom = effectiveRaw ? new Date(effectiveRaw) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) return back(PRICING, 'Invalid effective date.');
  const maxPerPeriod = String(formData.get('maxPerPeriod') ?? '').trim() ? int(formData.get('maxPerPeriod')) : null;
  const restrictions = String(formData.get('planRestrictions') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  await seedMarketingPrices();
  const latest = await prisma.marketingPriceItem.findFirst({ where: { operation }, orderBy: { version: 'desc' } });
  if (!latest) return back(PRICING, 'Operation not found.');
  const created = await prisma.marketingPriceItem.create({
    data: {
      operation,
      version: latest.version + 1,
      name: String(formData.get('name') ?? '').trim() || latest.name,
      description: latest.description,
      creditCost,
      rule: latest.rule ?? undefined,
      provider: latest.provider,
      model: latest.model,
      costCents: latest.costCents,
      maxFactor,
      planRestrictions: restrictions,
      billable: formData.get('billable') === 'on',
      maxPerPeriod,
      effectiveFrom,
      createdById: auth.admin.id,
    },
  });
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'marketing.price_version',
    targetType: 'MarketingPriceItem',
    targetId: created.id,
    before: { version: latest.version, creditCost: latest.creditCost, billable: latest.billable },
    after: { version: created.version, creditCost, billable: created.billable },
    reason,
    ipAddress: await ip(),
  });
  revalidatePath(PRICING);
  back(PRICING, `${operation} is now version ${created.version}.`);
}

export async function seedPricesAction(): Promise<void> {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return back(PRICING, 'Not authorized.');
  const count = await seedMarketingPrices();
  revalidatePath(PRICING);
  back(PRICING, `Seeded ${count} default price item(s).`);
}

export async function savePackageAction(formData: FormData): Promise<void> {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return back(PRICING, 'Not authorized.');
  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const credits = int(formData.get('credits'));
  const priceCents = int(formData.get('priceCents'));
  if (!name || !credits || !priceCents) return back(PRICING, 'Name, credits and price are required.');
  const data = {
    name,
    credits,
    priceCents,
    active: formData.get('active') === 'on',
    sortOrder: int(formData.get('sortOrder')) ?? 0,
  };
  const saved = id
    ? await prisma.marketingPackage.update({ where: { id }, data })
    : await prisma.marketingPackage.create({ data });
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: id ? 'marketing.package_update' : 'marketing.package_create',
    targetType: 'MarketingPackage',
    targetId: saved.id,
    after: data,
    reason: 'Marketing package change',
    ipAddress: await ip(),
  });
  revalidatePath(PRICING);
  back(PRICING, 'Package saved.');
}

/** Free-plan trial allowance (promotional credits). 0 disables it. */
export async function saveFreeAllowanceAction(formData: FormData): Promise<void> {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return back(PRICING, 'Not authorized.');
  const credits = int(formData.get('credits'));
  if (credits === null) return back(PRICING, 'Credits must be a whole number (0 disables the allowance).');
  const days = String(formData.get('expiryDays') ?? '').trim() ? int(formData.get('expiryDays')) : null;
  if (String(formData.get('expiryDays') ?? '').trim() && days === null) return back(PRICING, 'Expiry must be a whole number of days.');
  const mode = formData.get('mode') === 'MONTHLY' ? 'MONTHLY' : 'ONCE';
  const before = await getFreeAllowance();
  const next = { credits, mode, expiryDays: days } as const;
  await saveFreeAllowance({ ...next }, auth.admin.id);
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'marketing.free_allowance',
    targetType: 'AdminSetting',
    targetId: 'marketing.free_allowance',
    before,
    after: next,
    reason: String(formData.get('reason') ?? '').trim() || 'Free-plan marketing allowance change',
    ipAddress: await ip(),
  });
  revalidatePath(PRICING);
  back(PRICING, credits === 0 ? 'Trial allowance disabled.' : `Trial allowance set to ${credits} ${mode.toLowerCase()} promo credits.`);
}

/** Marks the current catalogue (price versions + packages) approved; any later change voids it. */
export async function approveCatalogueAction(): Promise<void> {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return back(PRICING, 'Not authorized.');
  await seedMarketingPrices();
  const approval = await approveCatalogue({ id: auth.admin.id, email: auth.admin.email ?? auth.admin.id });
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'marketing.catalogue_approve',
    targetType: 'AdminSetting',
    targetId: 'marketing.catalogue_approval',
    after: { fingerprint: approval.fingerprint },
    reason: 'Catalogue approved by product owner',
    ipAddress: await ip(),
  });
  revalidatePath(PRICING);
  back(PRICING, 'Catalogue approved. Package purchases are now enabled.');
}

/** Suspend an org's marketing and/or set its monthly credit limit. */
export async function setOrgControlAction(formData: FormData): Promise<void> {
  const auth = await requireAdmin('marketing-pricing:write');
  if (!auth.ok) return back(REPORTS, 'Not authorized.');
  const orgId = String(formData.get('orgId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!orgId || !reason) return back(REPORTS, 'Organisation and reason are required.');
  const suspend = formData.get('suspended') === 'on';
  const limitRaw = String(formData.get('monthlyLimit') ?? '').trim();
  const monthlyLimit = limitRaw ? int(limitRaw) : null;
  if (limitRaw && monthlyLimit === null) return back(REPORTS, 'Monthly limit must be a whole number.');
  const data = {
    suspendedAt: suspend ? new Date() : null,
    suspendedReason: suspend ? reason : null,
    monthlyLimit,
    updatedById: auth.admin.id,
  };
  await prisma.marketingOrgControl.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: suspend ? 'marketing.org_suspend' : 'marketing.org_update',
    targetType: 'MarketingOrg',
    targetId: orgId,
    after: { suspended: suspend, monthlyLimit },
    reason,
    ipAddress: await ip(),
  });
  revalidatePath(REPORTS);
  back(REPORTS, `Saved controls for ${orgId}.`);
}

/** Promo/support grant with optional expiry. Audited; written to the immutable ledger. */
export async function grantMarketingPromoAction(formData: FormData): Promise<void> {
  const auth = await requireAdmin('credits:write');
  if (!auth.ok) return back(REPORTS, 'Not authorized.');
  const userId = String(formData.get('userId') ?? '').trim();
  const amount = int(formData.get('amount'));
  const reason = String(formData.get('reason') ?? '').trim();
  const days = int(formData.get('expiryDays'));
  if (!userId || !amount || !reason) return back(REPORTS, 'User, amount and reason are required.');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return back(REPORTS, 'User not found.');
  const key = `promo:${userId}:${auth.admin.id}:${Date.now()}`;
  const result = await grantCredits({
    userId,
    amount,
    source: 'PROMO',
    kind: 'GRANT',
    expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
    idempotencyKey: key,
    note: reason,
    refType: 'admin',
    refId: auth.admin.id,
  });
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'marketing.promo_grant',
    targetType: 'User',
    targetId: userId,
    after: { amount, expiryDays: days, balanceAfter: result.balanceAfter },
    reason,
    ipAddress: await ip(),
  });
  revalidatePath(REPORTS);
  back(REPORTS, `Granted ${amount} promo credits.`);
}

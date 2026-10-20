import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';

import { grantCredits } from './wallet';

const ALLOWANCE_KEY = 'marketing.free_allowance';
const APPROVAL_KEY = 'marketing.catalogue_approval';

export type FreeAllowance = {
  /** Promotional credits granted per period. 0 disables the allowance. */
  credits: number;
  mode: 'ONCE' | 'MONTHLY';
  /** Days until the granted credits expire; null = never. */
  expiryDays: number | null;
};

export const DISABLED_ALLOWANCE: FreeAllowance = { credits: 0, mode: 'ONCE', expiryDays: 30 };

function wholeNumber(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Admin setting wins; FREE_PLAN_MARKETING_CREDITS (and _MODE / _EXPIRY_DAYS) are the env fallback. Default 0 = disabled. */
export async function getFreeAllowance(env: NodeJS.ProcessEnv = process.env): Promise<FreeAllowance> {
  const row = await prisma.adminSetting.findUnique({ where: { key: ALLOWANCE_KEY } });
  const stored = row?.value as Partial<FreeAllowance> | null | undefined;
  if (stored && typeof stored === 'object') {
    return {
      credits: wholeNumber(stored.credits) ?? 0,
      mode: stored.mode === 'MONTHLY' ? 'MONTHLY' : 'ONCE',
      expiryDays: stored.expiryDays == null ? null : (wholeNumber(stored.expiryDays) ?? 30),
    };
  }
  return {
    credits: wholeNumber(env.FREE_PLAN_MARKETING_CREDITS) ?? 0,
    mode: env.FREE_PLAN_MARKETING_CREDITS_MODE === 'MONTHLY' ? 'MONTHLY' : 'ONCE',
    expiryDays: wholeNumber(env.FREE_PLAN_MARKETING_CREDITS_EXPIRY_DAYS) ?? 30,
  };
}

export async function saveFreeAllowance(value: FreeAllowance, adminId: string) {
  await prisma.adminSetting.upsert({
    where: { key: ALLOWANCE_KEY },
    create: { key: ALLOWANCE_KEY, value, description: 'Free-plan marketing trial allowance', updatedById: adminId },
    update: { value, updatedById: adminId },
  });
}

/** Idempotency key: one grant per user (ONCE) or per user and UTC month (MONTHLY). */
export function trialGrantKey(userId: string, mode: FreeAllowance['mode'], now: Date) {
  return mode === 'MONTHLY' ? `trial:${userId}:${now.toISOString().slice(0, 7)}` : `trial:${userId}`;
}

/**
 * Server-side trial grant of PROMO credits for free-plan customers. Never called for internal scope (the caller only reaches
 * it after classification), paid plans never qualify, and the unique key makes repeats no-ops.
 */
export async function ensureTrialAllowance(input: { userId: string; plan: string; now?: Date; env?: NodeJS.ProcessEnv }) {
  if (input.plan !== 'free') return { granted: false as const, reason: 'not_free_plan' };
  const allowance = await getFreeAllowance(input.env);
  if (allowance.credits <= 0) return { granted: false as const, reason: 'disabled' };
  const now = input.now ?? new Date();
  const result = await grantCredits({
    userId: input.userId,
    amount: allowance.credits,
    source: 'PROMO',
    kind: 'GRANT',
    expiresAt: allowance.expiryDays ? new Date(now.getTime() + allowance.expiryDays * 86_400_000) : null,
    idempotencyKey: trialGrantKey(input.userId, allowance.mode, now),
    refType: 'trial_allowance',
    refId: input.userId,
    note: allowance.mode === 'MONTHLY' ? 'Free-plan monthly trial allowance' : 'Free-plan trial allowance',
  });
  return { granted: result.granted, reason: result.granted ? 'granted' : 'already_granted' };
}

type CatalogueItem = { operation: string; version: number };
type CataloguePackage = { id: string; credits: number; priceCents: number; active: boolean };

/** Stable hash of the catalogue: any new price version or package edit changes it and so voids the approval. */
export function catalogueFingerprint(items: CatalogueItem[], packages: CataloguePackage[]) {
  const latest = new Map<string, number>();
  for (const i of items) latest.set(i.operation, Math.max(latest.get(i.operation) ?? 0, i.version));
  const parts = [
    ...[...latest].sort(([a], [b]) => a.localeCompare(b)).map(([op, v]) => `p:${op}:${v}`),
    ...packages
      .filter((p) => p.active)
      .map((p) => `k:${p.id}:${p.credits}:${p.priceCents}`)
      .sort(),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

export type CatalogueApproval = { fingerprint: string; approvedById: string; approvedByEmail: string; approvedAt: string };

export async function currentFingerprint() {
  const [items, packages] = await Promise.all([
    prisma.marketingPriceItem.findMany({ select: { operation: true, version: true } }),
    prisma.marketingPackage.findMany({ select: { id: true, credits: true, priceCents: true, active: true } }),
  ]);
  return catalogueFingerprint(items, packages);
}

export async function getApproval(): Promise<{ approved: boolean; approval: CatalogueApproval | null; fingerprint: string }> {
  const [row, fingerprint] = await Promise.all([
    prisma.adminSetting.findUnique({ where: { key: APPROVAL_KEY } }),
    currentFingerprint(),
  ]);
  const approval = (row?.value as CatalogueApproval | null | undefined) ?? null;
  return { approved: !!approval && approval.fingerprint === fingerprint, approval, fingerprint };
}

export async function approveCatalogue(admin: { id: string; email: string }, now = new Date()) {
  const fingerprint = await currentFingerprint();
  const value: CatalogueApproval = { fingerprint, approvedById: admin.id, approvedByEmail: admin.email, approvedAt: now.toISOString() };
  await prisma.adminSetting.upsert({
    where: { key: APPROVAL_KEY },
    create: { key: APPROVAL_KEY, value, description: 'Approved marketing catalogue version', updatedById: admin.id },
    update: { value, updatedById: admin.id },
  });
  return value;
}

/** Package purchases need an approved catalogue unless MARKETING_CREDITS_ALLOW_UNAPPROVED=true. */
export async function purchasesAllowed(env: NodeJS.ProcessEnv = process.env) {
  if (env.MARKETING_CREDITS_ALLOW_UNAPPROVED === 'true') return true;
  return (await getApproval()).approved;
}

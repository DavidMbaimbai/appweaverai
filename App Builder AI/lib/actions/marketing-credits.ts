'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/require-user';
import { resolveBillingContext, BillingClassificationError } from '@/lib/marketing-credits/billing-class';
import { DEFAULT_PACKAGES } from '@/lib/marketing-credits/purchase';
import { purchasesAllowed } from '@/lib/marketing-credits/settings';
import { prisma } from '@/lib/prisma';
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe';

const userSelect = { id: true, email: true, name: true, stripeCustomerId: true } as const;

/** One-off Checkout for a marketing credit package. Credits are granted later, only by the verified webhook. */
export async function buyMarketingPackageAction(packageId: string) {
  const result = await requireUser(userSelect);
  if (result.error || !result.user) return { error: result.error };
  const user = result.user;

  let pkg: { id: string; name: string; credits: number; priceCents: number; currency: string } | null = null;
  if (packageId.startsWith('default:')) {
    const hit = DEFAULT_PACKAGES.find((p) => `default:${p.sortOrder}` === packageId);
    if (hit && (await prisma.marketingPackage.count({ where: { active: true } })) === 0) {
      pkg = { id: packageId, currency: 'usd', ...hit };
    }
  } else {
    const row = await prisma.marketingPackage.findFirst({ where: { id: packageId, active: true } });
    if (row) pkg = row;
  }
  if (!pkg) return { error: 'That package is not available.' };
  if (!(await purchasesAllowed())) {
    return { error: 'Marketing credit packages are not open for purchase yet: pricing is awaiting approval.' };
  }

  try {
    const stripe = getStripeClient();
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }
    const baseUrl = getAppBaseUrl();
    const metadata = {
      kind: 'marketing_credits',
      userId: user.id,
      packageId: pkg.id,
      packageName: pkg.name,
      credits: String(pkg.credits),
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pkg.currency,
            unit_amount: pkg.priceCents,
            product_data: { name: `Marketing credits: ${pkg.name}` },
          },
        },
      ],
      success_url: `${baseUrl}/app/marketing-credits?checkout=success`,
      cancel_url: `${baseUrl}/app/marketing-credits?checkout=cancel`,
      metadata,
      payment_intent_data: { metadata },
    });
    if (!session.url) return { error: 'Could not start checkout.' };
    return { url: session.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not start checkout.' };
  }
}

function limit(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Sets the per-project day/week/month marketing-credit budget (blank = no limit) and resumes a paused schedule. */
export async function saveProjectBudgetAction(projectId: string, formData: FormData) {
  const result = await requireUser({ id: true });
  if (result.error || !result.user) return { error: result.error };
  try {
    await resolveBillingContext({ userId: result.user.id, projectId });
  } catch (error) {
    if (error instanceof BillingClassificationError) return { error: error.message };
    throw error;
  }
  const dayLimit = limit(formData.get('dayLimit'));
  const weekLimit = limit(formData.get('weekLimit'));
  const monthLimit = limit(formData.get('monthLimit'));
  if (dayLimit === undefined || weekLimit === undefined || monthLimit === undefined) {
    return { error: 'Limits must be whole numbers.' };
  }
  const data = { dayLimit, weekLimit, monthLimit, pausedAt: null, pausedReason: null };
  await prisma.marketingProjectBudget.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
  revalidatePath('/app/marketing-credits');
  return { ok: true };
}

export async function saveLowBalanceThresholdAction(formData: FormData) {
  const result = await requireUser({ id: true });
  if (result.error || !result.user) return { error: result.error };
  const threshold = limit(formData.get('threshold'));
  if (threshold === undefined) return { error: 'Enter a whole number.' };
  await prisma.marketingWallet.upsert({
    where: { userId: result.user.id },
    create: { userId: result.user.id, lowBalanceThreshold: threshold },
    update: { lowBalanceThreshold: threshold, lowBalanceAlertSentAt: null },
  });
  revalidatePath('/app/marketing-credits');
  return { ok: true };
}

type Env = Record<string, string | undefined>;

/** Paid sales are OFF until the owner sets MARKETPLACE_PAID_SALES_ENABLED=true. Free assets never need Stripe. */
export function paidSalesEnabled(env: Env = process.env) {
  return env.MARKETPLACE_PAID_SALES_ENABLED?.trim().toLowerCase() === 'true';
}

/**
 * Platform fee in basis points (100 bps = 1%), parsed from MARKETPLACE_PLATFORM_FEE_PERCENT.
 * There is deliberately NO default: the final number is a business decision. Unset or invalid means null,
 * and paid sales stay blocked.
 */
export function platformFeeBps(env: Env = process.env): number | null {
  const raw = env.MARKETPLACE_PLATFORM_FEE_PERCENT?.trim();
  if (!raw) return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return Math.round(percent * 100);
}

export type SalesState = { enabled: true; feeBps: number } | { enabled: false; reason: string };

export function salesState(env: Env = process.env, stripeConfigured = Boolean(env.STRIPE_SECRET_KEY?.trim())): SalesState {
  if (!paidSalesEnabled(env)) return { enabled: false, reason: 'Paid assets are not enabled yet.' };
  const feeBps = platformFeeBps(env);
  if (feeBps === null) return { enabled: false, reason: 'Paid assets are blocked: the platform fee has not been configured.' };
  if (!stripeConfigured) return { enabled: false, reason: 'Paid assets are blocked: Stripe is not configured.' };
  return { enabled: true, feeBps };
}

/**
 * Creator payouts need Stripe Connect (account onboarding + transfers), which is not implemented.
 * Earnings accrue in the ledger; nothing is ever transferred.
 */
export const PAYOUTS_BLOCKED_MESSAGE = 'Payouts blocked: needs Stripe Connect configuration. Earnings are recorded in your ledger but nothing is paid out yet.';

export function takedownContact(env: Env = process.env) {
  return env.MARKETPLACE_TAKEDOWN_EMAIL?.trim() || null;
}

export function maxSubmissionsPerDay(env: Env = process.env) {
  const value = Number(env.MARKETPLACE_MAX_SUBMISSIONS_PER_DAY);
  return Number.isInteger(value) && value > 0 ? value : 5;
}

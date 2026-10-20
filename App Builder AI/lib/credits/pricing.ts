/**
 * Credit pricing for AppWeaver AI operations.
 *
 * Credits only pay for AppWeaver's own AI/compute work. Third-party charges
 * (Meta/Facebook ad spend, SMS, phone calls, domain purchases, etc.) are billed
 * by those providers or passed through separately and are NEVER paid in credits.
 *
 * Override any price with the `CREDIT_PRICES` env var, e.g.
 * `CREDIT_PRICES={"agent_run":40,"video_per_second":12}`.
 */

export type CreditOperation =
  | 'agent_run'
  | 'studio_text'
  | 'studio_image'
  | 'launch_kit'
  | 'customer_ad'
  | 'video_per_second'
  | 'design_import'
  | 'marketing_campaign'
  | 'review_ai';

export const CREDIT_OPERATION_LABELS: Record<CreditOperation, string> = {
  agent_run: 'AI builder run',
  studio_text: 'Studio tool',
  studio_image: 'Studio image',
  launch_kit: 'Launch kit',
  customer_ad: 'Ad copy and image',
  video_per_second: 'Video generation',
  design_import: 'Design import',
  marketing_campaign: 'Marketing campaign',
  review_ai: 'Review reply AI',
};

/**
 * Agent runs are a flat charge per run (not per token): the real token cost
 * varies, but a flat price is predictable for the user and cannot be
 * under-collected by a metering bug. Failed runs are refunded in full.
 */
const DEFAULT_PRICES: Record<Exclude<CreditOperation, 'video_per_second'>, number> = {
  agent_run: 25,
  studio_text: 4,
  studio_image: 10,
  launch_kit: 20,
  customer_ad: 15,
  design_import: 5,
  marketing_campaign: 12,
  review_ai: 2,
};

/** Nominal value of one credit in cents, used only to derive the video price. */
const DEFAULT_CENTS_PER_CREDIT = 1.5;
const VIDEO_MARGIN = 2;
/** Nova Reel list price is roughly 8 cents per generated second. */
const DEFAULT_VIDEO_COST_CENTS_PER_SECOND = 8;

function positiveNumber(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePriceOverrides(raw: string | undefined): Partial<Record<CreditOperation, number>> {
  if (!raw?.trim()) return {};
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: Partial<Record<CreditOperation, number>> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key in CREDIT_OPERATION_LABELS && typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        out[key as CreditOperation] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function videoCreditsPerSecond(env: NodeJS.ProcessEnv = process.env) {
  const costCents = positiveNumber(env.VIDEO_NOVA_REEL_CENTS_PER_SECOND, DEFAULT_VIDEO_COST_CENTS_PER_SECOND);
  const centsPerCredit = positiveNumber(env.CREDIT_CENTS_VALUE, DEFAULT_CENTS_PER_CREDIT);
  return Math.max(1, Math.ceil((costCents * VIDEO_MARGIN) / centsPerCredit));
}

export type CreditQuote = {
  operation: CreditOperation;
  credits: number;
  /** Human readable, e.g. "Video generation: 5s x 11 = 55 credits". */
  estimate: string;
};

export function quote(
  operation: CreditOperation,
  params: { seconds?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): CreditQuote {
  const overrides = parsePriceOverrides(env.CREDIT_PRICES);
  const label = CREDIT_OPERATION_LABELS[operation];

  if (operation === 'video_per_second') {
    const seconds = Math.max(1, Math.ceil(params.seconds ?? 1));
    const perSecond = overrides.video_per_second ?? videoCreditsPerSecond(env);
    const credits = perSecond * seconds;
    return { operation, credits, estimate: `${label}: ${seconds}s x ${perSecond} = ${credits} credits` };
  }

  const credits = overrides[operation] ?? DEFAULT_PRICES[operation];
  return { operation, credits, estimate: `${label}: ${credits} credit${credits === 1 ? '' : 's'}` };
}

import { prisma } from '@/lib/prisma';

import { videoCreditsPerSecond } from '@/lib/credits/pricing';

/**
 * Marketing credits pay for AppWeaver's own marketing AI work. Third-party spend
 * (Meta ad budgets, carrier fees) is never paid from a wallet except the explicit
 * passthrough items (sms/whatsapp/voice), which are priced at provider cost + margin.
 */

export type MarketingOperation =
  | 'text_post'
  | 'campaign_draft'
  | 'ad_pack'
  | 'image'
  | 'customer_ad'
  | 'video_per_second'
  | 'translation'
  | 'subtitles'
  | 'engagement_reply'
  | 'growth_draft'
  | 'lead_followup'
  | 'sms'
  | 'whatsapp'
  | 'voice_minute'
  | 'schedule_post'
  | 'publish_post'
  | 'lead_reminder'
  | 'campaign_send';

export type MarketingPriceDefinition = {
  operation: MarketingOperation;
  name: string;
  description: string;
  creditCost: number;
  /** When set, creditCost is per unit (second, language, message, minute). */
  unit?: 'second' | 'language' | 'message' | 'minute';
  provider?: string;
  model?: string;
  costCents?: number;
  maxFactor: number;
  billable: boolean;
  planRestrictions: string[];
  maxPerPeriod?: number | null;
};

/** One credit is worth about 1.5 cents; passthrough items use cost x 1.2 margin. */
const CENTS_PER_CREDIT = 1.5;
const passthrough = (costCents: number) => Math.max(1, Math.ceil((costCents * 1.2) / CENTS_PER_CREDIT));

export const DEFAULT_MARKETING_PRICES: MarketingPriceDefinition[] = [
  { operation: 'text_post', name: 'Social text post', description: 'AI-written post copy', creditCost: 3, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 0.5 },
  { operation: 'campaign_draft', name: 'Marketing campaign', description: 'Multi-channel campaign draft', creditCost: 8, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 2 },
  { operation: 'ad_pack', name: 'Ad pack', description: 'Ad copy variants', creditCost: 8, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 2 },
  { operation: 'image', name: 'Marketing image', description: 'AI-generated image', creditCost: 8, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', model: 'image', costCents: 4 },
  { operation: 'customer_ad', name: 'Ad copy and image', description: 'Meta ad copy plus creative', creditCost: 15, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 6 },
  {
    operation: 'video_per_second',
    name: 'Video generation',
    description: 'Per generated second (Nova Reel cost plus margin)',
    creditCost: videoCreditsPerSecond(),
    unit: 'second',
    provider: 'bedrock',
    model: 'amazon.nova-reel',
    costCents: 8,
    maxFactor: 1,
    billable: true,
    planRestrictions: [],
  },
  { operation: 'translation', name: 'Translation', description: 'Per language', creditCost: 2, unit: 'language', maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 0.5 },
  { operation: 'subtitles', name: 'Subtitles', description: 'Per language', creditCost: 2, unit: 'language', maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 0.5 },
  { operation: 'engagement_reply', name: 'Engagement reply', description: 'AI reply to a comment or DM', creditCost: 1, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 0.3 },
  { operation: 'growth_draft', name: 'Growth experiments', description: 'Growth agent campaign drafts', creditCost: 6, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 1.5 },
  { operation: 'lead_followup', name: 'Lead follow-up draft', description: 'AI follow-up email', creditCost: 2, maxFactor: 1, billable: true, planRestrictions: [], provider: 'bedrock', costCents: 0.5 },
  { operation: 'sms', name: 'SMS', description: 'Passthrough: carrier cost plus margin, per message', creditCost: passthrough(1), unit: 'message', maxFactor: 1.25, provider: 'twilio', costCents: 1, billable: true, planRestrictions: [] },
  { operation: 'whatsapp', name: 'WhatsApp message', description: 'Passthrough: provider cost plus margin, per message', creditCost: passthrough(1.5), unit: 'message', maxFactor: 1.25, provider: 'twilio', costCents: 1.5, billable: true, planRestrictions: [] },
  { operation: 'voice_minute', name: 'Voice call', description: 'Passthrough: provider cost plus margin, per minute', creditCost: passthrough(2), unit: 'minute', maxFactor: 1.25, provider: 'twilio', costCents: 2, billable: true, planRestrictions: [] },
  { operation: 'schedule_post', name: 'Schedule a post', description: 'Free by default', creditCost: 0, maxFactor: 1, billable: false, planRestrictions: [] },
  { operation: 'publish_post', name: 'Publish a post', description: 'Free by default', creditCost: 0, maxFactor: 1, billable: false, planRestrictions: [] },
  { operation: 'lead_reminder', name: 'Lead reminder digest', description: 'Scheduled follow-up reminder email; free by default', creditCost: 0, maxFactor: 1, billable: false, planRestrictions: [] },
  { operation: 'campaign_send', name: 'Investor campaign email', description: 'One scheduled campaign email; free by default', creditCost: 0, maxFactor: 1, billable: false, planRestrictions: [] },
];

export const MARKETING_OPERATIONS = DEFAULT_MARKETING_PRICES.map((p) => p.operation);

export function isMarketingOperation(value: string): value is MarketingOperation {
  return (MARKETING_OPERATIONS as string[]).includes(value);
}

export type ActivePrice = MarketingPriceDefinition & { version: number };

export type PriceRow = {
  operation: string;
  version: number;
  name: string;
  description: string;
  creditCost: number;
  rule: unknown;
  provider: string | null;
  model: string | null;
  costCents: number | null;
  maxFactor: number;
  planRestrictions: string[];
  billable: boolean;
  maxPerPeriod: number | null;
  effectiveFrom: Date;
};

function fromRow(row: PriceRow): ActivePrice {
  const rule = (row.rule ?? {}) as { unit?: ActivePrice['unit'] };
  return {
    operation: row.operation as MarketingOperation,
    version: row.version,
    name: row.name,
    description: row.description,
    creditCost: row.creditCost,
    unit: rule.unit,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    costCents: row.costCents ?? undefined,
    maxFactor: row.maxFactor,
    billable: row.billable,
    planRestrictions: row.planRestrictions,
    maxPerPeriod: row.maxPerPeriod,
  };
}

/** Latest version whose effectiveFrom has passed; code defaults when no row exists. */
export function pickActivePrices(rows: PriceRow[], now = new Date()): Map<MarketingOperation, ActivePrice> {
  const map = new Map<MarketingOperation, ActivePrice>();
  for (const def of DEFAULT_MARKETING_PRICES) map.set(def.operation, { ...def, version: 0 });
  const ordered = rows.filter((r) => r.effectiveFrom <= now).sort((a, b) => a.version - b.version);
  for (const row of ordered) map.set(row.operation as MarketingOperation, fromRow(row));
  return map;
}

export async function getActivePrices(now = new Date()) {
  const rows = (await prisma.marketingPriceItem.findMany({
    where: { effectiveFrom: { lte: now } },
    orderBy: { version: 'asc' },
  })) as PriceRow[];
  return pickActivePrices(rows, now);
}

export type MarketingQuote = {
  operation: MarketingOperation;
  billable: boolean;
  /** Expected charge. */
  credits: number;
  /** Most that can ever be charged (reserved up front). */
  maxCredits: number;
  estimate: string;
  version: number;
  planRestrictions: string[];
  maxPerPeriod: number | null;
};

export function quoteWith(
  prices: Map<MarketingOperation, ActivePrice>,
  operation: MarketingOperation,
  params: { seconds?: number; units?: number } = {},
): MarketingQuote {
  const price =
    prices.get(operation) ?? { ...DEFAULT_MARKETING_PRICES.find((p) => p.operation === operation)!, version: 0 };
  const units =
    price.unit === 'second'
      ? Math.max(1, Math.ceil(params.seconds ?? 1))
      : price.unit
        ? Math.max(1, Math.ceil(params.units ?? 1))
        : 1;
  const credits = price.billable ? price.creditCost * units : 0;
  const maxCredits = price.billable ? Math.ceil(credits * Math.max(1, price.maxFactor)) : 0;
  const estimate = !price.billable
    ? `${price.name}: free`
    : price.unit
      ? `${price.name}: ${units} ${price.unit}${units === 1 ? '' : 's'} x ${price.creditCost} = ${credits} marketing credits${maxCredits > credits ? ` (max ${maxCredits})` : ''}`
      : `${price.name}: ${credits} marketing credit${credits === 1 ? '' : 's'}`;
  return {
    operation,
    billable: price.billable,
    credits,
    maxCredits,
    estimate,
    version: price.version,
    planRestrictions: price.planRestrictions,
    maxPerPeriod: price.maxPerPeriod ?? null,
  };
}

export async function quoteMarketing(
  operation: MarketingOperation,
  params: { seconds?: number; units?: number } = {},
) {
  return quoteWith(await getActivePrices(), operation, params);
}

/** Inserts missing defaults as version 1 rows so admins can version from them. */
export async function seedMarketingPrices() {
  const existing = await prisma.marketingPriceItem.findMany({ select: { operation: true } });
  const have = new Set(existing.map((r: { operation: string }) => r.operation));
  const missing = DEFAULT_MARKETING_PRICES.filter((p) => !have.has(p.operation));
  if (missing.length === 0) return 0;
  await prisma.marketingPriceItem.createMany({
    data: missing.map((p) => ({
      operation: p.operation,
      version: 1,
      name: p.name,
      description: p.description,
      creditCost: p.creditCost,
      rule: p.unit ? { type: 'per_unit', unit: p.unit } : undefined,
      provider: p.provider,
      model: p.model,
      costCents: p.costCents,
      maxFactor: p.maxFactor,
      planRestrictions: p.planRestrictions,
      billable: p.billable,
      maxPerPeriod: p.maxPerPeriod ?? null,
    })),
    skipDuplicates: true,
  });
  return missing.length;
}

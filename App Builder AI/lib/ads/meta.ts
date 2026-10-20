const GRAPH = 'https://graph.facebook.com/v21.0';

export function metaAdsConfig() {
  const accountId = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, '');
  const token = process.env.META_ADS_ACCESS_TOKEN?.trim();
  const pageId = process.env.META_PAGE_ID?.trim();
  return { accountId, token, pageId };
}

/** Spending is opt-in: nothing runs unless META_ADS_ENABLED=true and credentials exist. */
export function metaAdsEnabled() {
  const { accountId, token, pageId } = metaAdsConfig();
  return process.env.META_ADS_ENABLED === 'true' && Boolean(accountId && token && pageId);
}

/** Hard ceiling in minor currency units (cents); config can only lower it. */
export const MAX_DAILY_BUDGET_CENTS = 500;

export function dailyBudgetCents() {
  const n = Number(process.env.META_ADS_DAILY_BUDGET_CENTS);
  const wanted = Number.isFinite(n) && n > 0 ? Math.floor(n) : MAX_DAILY_BUDGET_CENTS;
  return Math.min(wanted, MAX_DAILY_BUDGET_CENTS);
}

async function graph<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const { token } = metaAdsConfig();
  const url = new URL(`${GRAPH}/${path}`);
  const init: RequestInit = { signal: AbortSignal.timeout(30_000) };
  if (body) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    form.set('access_token', token ?? '');
    init.method = 'POST';
    init.body = form;
  } else {
    url.searchParams.set('access_token', token ?? '');
  }
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok || data.error) {
    throw new Error(`Meta API ${path}: ${data.error?.message ?? response.status}`);
  }
  return data;
}

const account = () => `act_${metaAdsConfig().accountId}`;

export async function createCampaign(name: string) {
  const res = await graph<{ id: string }>(`${account()}/campaigns`, {
    name,
    objective: 'OUTCOME_TRAFFIC',
    status: 'ACTIVE',
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  return res.id;
}

/** One ad set holds the whole budget, so total spend can never exceed the daily cap. */
export async function createAdSet(campaignId: string, name: string) {
  const countries = (process.env.META_ADS_COUNTRIES ?? 'US,GB,CA,AU')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const res = await graph<{ id: string }>(`${account()}/adsets`, {
    name,
    campaign_id: campaignId,
    daily_budget: dailyBudgetCents(),
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: {
      geo_locations: { countries },
      age_min: 18,
      publisher_platforms: ['facebook', 'instagram'],
      targeting_automation: { advantage_audience: 1 },
    },
    status: 'ACTIVE',
  });
  return res.id;
}

export async function uploadImage(base64: string) {
  const res = await graph<{ images: Record<string, { hash: string }> }>(
    `${account()}/adimages`,
    { bytes: base64 },
  );
  const first = Object.values(res.images)[0];
  if (!first?.hash) throw new Error('Meta did not return an image hash.');
  return first.hash;
}

export async function createAd(input: {
  name: string;
  adSetId: string;
  imageHash: string;
  headline: string;
  primaryText: string;
  link: string;
}) {
  const creative = await graph<{ id: string }>(`${account()}/adcreatives`, {
    name: input.name,
    object_story_spec: {
      page_id: metaAdsConfig().pageId,
      link_data: {
        image_hash: input.imageHash,
        link: input.link,
        message: input.primaryText,
        name: input.headline,
        call_to_action: { type: 'SIGN_UP', value: { link: input.link } },
      },
    },
  });
  const ad = await graph<{ id: string }>(`${account()}/ads`, {
    name: input.name,
    adset_id: input.adSetId,
    creative: { creative_id: creative.id },
    status: 'ACTIVE',
  });
  return ad.id;
}

export async function setAdStatus(adId: string, status: 'ACTIVE' | 'PAUSED') {
  await graph(adId, { status });
}

export type AdInsights = { spendCents: number; impressions: number; clicks: number };

export async function getAdInsights(adId: string): Promise<AdInsights> {
  const res = await graph<{
    data?: { spend?: string; impressions?: string; clicks?: string }[];
  }>(`${adId}/insights?fields=spend,impressions,clicks&date_preset=maximum`);
  const row = res.data?.[0];
  return {
    spendCents: Math.round(Number(row?.spend ?? 0) * 100),
    impressions: Number(row?.impressions ?? 0),
    clicks: Number(row?.clicks ?? 0),
  };
}

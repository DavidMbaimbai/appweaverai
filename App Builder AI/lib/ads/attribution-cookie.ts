export const ATTRIBUTION_COOKIE = 'aw_attr';
export const ATTRIBUTION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type Attribution = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
};

const clean = (value: string | null | undefined) => {
  const v = value?.trim().slice(0, 80);
  return v && /^[\w.\-~ ]+$/.test(v) ? v : undefined;
};

/** Reads UTM parameters from a landing URL. Returns null when there are none. */
export function attributionFromSearch(params: URLSearchParams): Attribution | null {
  const attribution: Attribution = {
    source: clean(params.get('utm_source')),
    medium: clean(params.get('utm_medium')),
    campaign: clean(params.get('utm_campaign')),
    content: clean(params.get('utm_content')),
  };
  return attribution.source || attribution.content ? attribution : null;
}

export function parseAttributionCookie(cookieHeader: string | null | undefined): Attribution | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ATTRIBUTION_COOKIE}=`));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(ATTRIBUTION_COOKIE.length + 1)));
    const params = new URLSearchParams();
    for (const key of ['source', 'medium', 'campaign', 'content'] as const) {
      if (typeof parsed?.[key] === 'string') params.set(`utm_${key}`, parsed[key]);
    }
    return attributionFromSearch(params);
  } catch {
    return null;
  }
}

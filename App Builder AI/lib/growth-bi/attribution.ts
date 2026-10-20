import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * First-party, privacy-respecting attribution. Pure logic only (no database), so first/last touch,
 * channel classification and cookie signing are unit-testable.
 */

export const GROWTH_COOKIE = 'aw_gv';
export const GROWTH_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const CONSENT_COOKIE = 'aw_cookie_consent';

export type Touch = {
  channel: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  referrerHost?: string;
  landingPath: string;
  at: string;
};

export type GrowthCookie = { v: string; first: Touch; last: Touch };

const SAFE = /^[\w.\-~ /]+$/;
const clean = (value: string | null | undefined, max = 80) => {
  const v = value?.trim().slice(0, max);
  return v && SAFE.test(v) ? v.toLowerCase() : undefined;
};

const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'baidu.', 'ecosia.', 'brave.'];
const SOCIAL_HOSTS = ['facebook.', 'instagram.', 'twitter.', 'x.com', 't.co', 'linkedin.', 'lnkd.in', 'tiktok.', 'youtube.', 'reddit.', 'news.ycombinator.'];

/** Hostname only; never the path or query of the referring page. Self-referrals are dropped. */
export function referrerHostOf(referrer: string | null | undefined, ownHosts: readonly string[] = []): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || ownHosts.some((own) => host === own || host.endsWith(`.${own}`))) return undefined;
    return host.slice(0, 120);
  } catch {
    return undefined;
  }
}

/** Stable channel label: "source/medium" for tagged traffic, else organic/social/referral/direct from the referrer. */
export function classifyChannel(input: { source?: string; medium?: string; referrerHost?: string }): string {
  if (input.source) return `${input.source}/${input.medium ?? 'unknown'}`;
  const host = input.referrerHost;
  if (!host) return 'direct';
  if (SEARCH_HOSTS.some((s) => host.includes(s))) return 'organic-search';
  if (SOCIAL_HOSTS.some((s) => host.includes(s))) return 'organic-social';
  return `referral/${host}`;
}

export function buildTouch(input: { search: URLSearchParams; referrer?: string | null; path: string; ownHosts?: readonly string[]; now?: Date }): Touch {
  const source = clean(input.search.get('utm_source'));
  const medium = clean(input.search.get('utm_medium'));
  const campaign = clean(input.search.get('utm_campaign'));
  const content = clean(input.search.get('utm_content'));
  const term = clean(input.search.get('utm_term'));
  const referrerHost = referrerHostOf(input.referrer, input.ownHosts);
  const path = input.path.split(/[?#]/)[0].slice(0, 200) || '/';
  return {
    channel: classifyChannel({ source, medium, referrerHost }),
    ...(source ? { source } : {}),
    ...(medium ? { medium } : {}),
    ...(campaign ? { campaign } : {}),
    ...(content ? { content } : {}),
    ...(term ? { term } : {}),
    ...(referrerHost ? { referrerHost } : {}),
    landingPath: path.startsWith('/') ? path : '/',
    at: (input.now ?? new Date()).toISOString(),
  };
}

/** Tagged or externally referred traffic. A bare direct hit never displaces an earlier last touch. */
export const isInformativeTouch = (touch: Touch) => touch.channel !== 'direct';

/**
 * First touch is written once and never changes. Last touch is replaced by every later informative touch, so a
 * returning direct visit keeps crediting the last campaign that actually brought the person.
 */
export function mergeTouch(previous: GrowthCookie | null, touch: Touch, newVisitorId: () => string = () => randomBytes(12).toString('hex')): GrowthCookie {
  if (!previous) return { v: newVisitorId(), first: touch, last: touch };
  return { v: previous.v, first: previous.first, last: isInformativeTouch(touch) ? touch : previous.last };
}

/** Do Not Track / Global Privacy Control are honoured: nothing is recorded or set. */
export function trackingRefused(headers: { get(name: string): string | null }) {
  return headers.get('dnt') === '1' || headers.get('sec-gpc') === '1';
}

export function readConsent(cookieHeader: string | null | undefined): 'all' | 'essential' | null {
  const raw = cookieHeader?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${CONSENT_COOKIE}=`));
  const value = raw?.slice(CONSENT_COOKIE.length + 1);
  return value === 'all' || value === 'essential' ? value : null;
}

/** Analytics cookies are only set with explicit "all" consent and no DNT/GPC signal. */
export const mayTrack = (headers: { get(name: string): string | null }) =>
  !trackingRefused(headers) && readConsent(headers.get('cookie')) === 'all';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

export function signCookie(cookie: GrowthCookie, secret: string): string {
  const body = b64(JSON.stringify(cookie));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyCookie(value: string | undefined | null, secret: string): GrowthCookie | null {
  if (!value || !secret) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GrowthCookie;
    if (typeof parsed?.v !== 'string' || !parsed.first?.channel || !parsed.last?.channel) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readGrowthCookie(cookieHeader: string | null | undefined, secret: string): GrowthCookie | null {
  const raw = cookieHeader?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${GROWTH_COOKIE}=`));
  return raw ? verifyCookie(decodeURIComponent(raw.slice(GROWTH_COOKIE.length + 1)), secret) : null;
}

export function growthSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.GROWTH_COOKIE_SECRET?.trim() || env.BETTER_AUTH_SECRET?.trim() || env.AUTH_SECRET?.trim() || '';
}

export const UTM_KINDS = ['HOUSE_AD', 'SOCIAL_POST', 'INVESTOR_OUTREACH', 'OTHER'] as const;
export type UtmKind = (typeof UTM_KINDS)[number];

export type UtmLinkInput = { baseUrl: string; source: string; medium: string; campaign: string; content?: string; term?: string };

/** Builds a tagged URL; rejects non-http(s) URLs and unsafe tag values. */
export function buildUtmUrl(input: UtmLinkInput): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    return { ok: false, error: 'Enter a full URL, e.g. https://appweaverai.com/.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Only http(s) URLs can be tagged.' };
  const tags: [string, string | undefined][] = [
    ['utm_source', input.source],
    ['utm_medium', input.medium],
    ['utm_campaign', input.campaign],
    ['utm_content', input.content],
    ['utm_term', input.term],
  ];
  for (const [key, raw] of tags) {
    const value = raw?.trim();
    if (!value) {
      if (key === 'utm_source' || key === 'utm_medium' || key === 'utm_campaign') return { ok: false, error: `${key} is required.` };
      continue;
    }
    const safe = clean(value);
    if (!safe) return { ok: false, error: `${key} may only use letters, numbers, spaces and . _ - ~ / (max 80).` };
    url.searchParams.set(key, safe);
  }
  return { ok: true, url: url.toString() };
}

export type LinkRef = { kind: string; source: string; medium: string; campaign: string; content?: string | null };

/** Resolves what kind of campaign a touch belongs to: a recorded link, a house ad (aw_auto), or unknown. */
export function campaignKind(touch: Pick<Touch, 'source' | 'medium' | 'campaign' | 'content'>, links: readonly LinkRef[]): string {
  if (!touch.campaign && !touch.source) return 'UNTAGGED';
  const hit = links.find(
    (l) => l.campaign.toLowerCase() === touch.campaign && l.source.toLowerCase() === touch.source && (!l.content || l.content.toLowerCase() === touch.content),
  );
  if (hit) return hit.kind;
  if (touch.campaign === 'aw_auto') return 'HOUSE_AD';
  return 'UNRECORDED_LINK';
}

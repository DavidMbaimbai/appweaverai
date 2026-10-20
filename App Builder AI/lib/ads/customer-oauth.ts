import { createHmac, timingSafeEqual } from 'node:crypto';

import { graph } from '@/lib/ads/meta';

const SCOPES = 'ads_management,ads_read,business_management,pages_show_list,pages_read_engagement';
const STATE_TTL_MS = 10 * 60 * 1000;

export function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '') ||
    'https://appweaverai.com'
  );
}

export const redirectUri = () => `${appBaseUrl()}/api/meta-ads/callback`;

export function customerAdsConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

const sign = (payload: string) =>
  createHmac('sha256', process.env.META_APP_SECRET ?? '').update(payload).digest('hex');

/** Signed, expiring state ties the OAuth callback to the user who started it. */
export function createState(userId: string, now = Date.now()) {
  const payload = `${userId}.${now}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: string | null, now = Date.now()): string | null {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [userId, issued, signature] = parts;
  const expected = sign(`${userId}.${issued}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const age = now - Number(issued);
  return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_MS ? userId : null;
}

export function loginUrl(userId: string) {
  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', createState(userId));
  url.searchParams.set('scope', SCOPES);
  return url.toString();
}

/** Exchanges the OAuth code for a long-lived (about 60 day) user token. */
export async function exchangeCode(code: string) {
  const short = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  short.searchParams.set('client_id', process.env.META_APP_ID ?? '');
  short.searchParams.set('client_secret', process.env.META_APP_SECRET ?? '');
  short.searchParams.set('redirect_uri', redirectUri());
  short.searchParams.set('code', code);
  const first = await fetchJson<{ access_token?: string }>(short);

  const long = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  long.searchParams.set('grant_type', 'fb_exchange_token');
  long.searchParams.set('client_id', process.env.META_APP_ID ?? '');
  long.searchParams.set('client_secret', process.env.META_APP_SECRET ?? '');
  long.searchParams.set('fb_exchange_token', first.access_token ?? '');
  const second = await fetchJson<{ access_token?: string; expires_in?: number }>(long);
  if (!second.access_token) throw new Error('Meta did not return a token.');
  return {
    token: second.access_token,
    expiresAt: second.expires_in ? new Date(Date.now() + second.expires_in * 1000) : null,
  };
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok || data.error) {
    throw new Error(`Meta OAuth: ${data.error?.message ?? response.status}`);
  }
  return data;
}

export type MetaAssets = {
  adAccounts: { id: string; name: string; currency: string }[];
  pages: { id: string; name: string }[];
};

export async function listAssets(token: string): Promise<MetaAssets> {
  const [accounts, pages] = await Promise.all([
    graph<{ data?: { id: string; name: string; currency: string; account_status: number }[] }>(
      'me/adaccounts?fields=name,currency,account_status&limit=50',
      undefined,
      token,
    ),
    graph<{ data?: { id: string; name: string }[] }>('me/accounts?fields=name&limit=50', undefined, token),
  ]);
  return {
    adAccounts: (accounts.data ?? [])
      .filter((a) => a.account_status === 1)
      .map((a) => ({ id: a.id.replace(/^act_/, ''), name: a.name, currency: a.currency })),
    pages: (pages.data ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
}

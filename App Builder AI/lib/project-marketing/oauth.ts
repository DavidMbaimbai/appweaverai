import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { graph } from '@/lib/ads/meta';
import { appBaseUrl } from '@/lib/ads/customer-oauth';

export type ConnectPlatform = 'X' | 'LINKEDIN' | 'FACEBOOK';

const STATE_TTL_MS = 10 * 60 * 1000;
const FB = 'https://www.facebook.com/v21.0/dialog/oauth';

export function isConnectPlatform(value: string): value is ConnectPlatform {
  return value === 'X' || value === 'LINKEDIN' || value === 'FACEBOOK';
}

function credentials(platform: ConnectPlatform) {
  switch (platform) {
    case 'X':
      return { id: process.env.X_CLIENT_ID, secret: process.env.X_CLIENT_SECRET };
    case 'LINKEDIN':
      return { id: process.env.LINKEDIN_CLIENT_ID, secret: process.env.LINKEDIN_CLIENT_SECRET };
    case 'FACEBOOK':
      return { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
  }
}

/** X public clients have no secret; LinkedIn and Facebook need both. */
export function isConnectConfigured(platform: ConnectPlatform) {
  const { id, secret } = credentials(platform);
  return platform === 'X' ? Boolean(id) : Boolean(id && secret);
}

export const redirectUri = (platform: ConnectPlatform) =>
  `${appBaseUrl()}/api/project-marketing/callback/${platform.toLowerCase()}`;

const b64 = (buf: Buffer) => buf.toString('base64url');
const signingKey = (platform: ConnectPlatform) => credentials(platform).secret || credentials(platform).id || '';
const sign = (platform: ConnectPlatform, payload: string) =>
  createHmac('sha256', signingKey(platform)).update(`pm:${platform}:${payload}`).digest('hex');

export type OAuthState = { userId: string; returnTo: string };

/** Signed, expiring state binds the callback to the user and project page that started it. */
export function createState(platform: ConnectPlatform, data: OAuthState, now = Date.now()) {
  const payload = b64(Buffer.from(JSON.stringify({ u: data.userId, r: data.returnTo, t: now })));
  return `${payload}.${sign(platform, payload)}`;
}

export function verifyState(platform: ConnectPlatform, state: string | null, now = Date.now()): OAuthState | null {
  if (!state) return null;
  const [payload, signature, ...rest] = state.split('.');
  if (!payload || !signature || rest.length) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(platform, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, r, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const age = now - Number(t);
    if (typeof u !== 'string' || typeof r !== 'string' || !(age >= 0 && age <= STATE_TTL_MS)) return null;
    return { userId: u, returnTo: r };
  } catch {
    return null;
  }
}

/** "workspace-slug/project-slug" only, so the redirect can never leave the app. */
export function safeReturnTo(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}

export function createPkce() {
  const verifier = b64(randomBytes(48));
  return { verifier, challenge: b64(createHash('sha256').update(verifier).digest()) };
}

export function authorizeUrl(platform: ConnectPlatform, state: string, challenge?: string) {
  const { id } = credentials(platform);
  const url = new URL(
    platform === 'X'
      ? 'https://x.com/i/oauth2/authorize'
      : platform === 'LINKEDIN'
        ? 'https://www.linkedin.com/oauth/v2/authorization'
        : FB,
  );
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', id ?? '');
  url.searchParams.set('redirect_uri', redirectUri(platform));
  url.searchParams.set('state', state);
  if (platform === 'X') {
    url.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
    url.searchParams.set('code_challenge', challenge ?? '');
    url.searchParams.set('code_challenge_method', 'S256');
  } else if (platform === 'LINKEDIN') {
    url.searchParams.set('scope', 'openid profile w_member_social');
  } else {
    url.searchParams.set(
      'scope',
      'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish',
    );
  }
  return url.toString();
}

export type FacebookPage = { id: string; name: string; access_token: string };

export type ConnectionTokens = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
  accountName: string | null;
  accountId: string | null;
  /** Facebook only: every Page the user manages, so the owner can choose. */
  pages?: FacebookPage[];
};

async function tokenRequest<T>(url: string, body: Record<string, string>, basic?: { id: string; secret: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string };
  if (!response.ok || data.error) {
    throw new Error(`OAuth token request failed (${response.status}): ${data.error_description ?? String(data.error ?? '')}`);
  }
  return data;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };

const expiry = (seconds?: number) => (seconds ? new Date(Date.now() + seconds * 1000) : null);

export async function exchangeCode(platform: ConnectPlatform, code: string, verifier?: string): Promise<ConnectionTokens> {
  const { id, secret } = credentials(platform);
  if (platform === 'X') {
    const data = await tokenRequest<TokenResponse>(
      'https://api.x.com/2/oauth2/token',
      { code, grant_type: 'authorization_code', client_id: id ?? '', redirect_uri: redirectUri('X'), code_verifier: verifier ?? '' },
      secret ? { id: id ?? '', secret } : undefined,
    );
    if (!data.access_token) throw new Error('X did not return a token.');
    const me = await fetch('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
      signal: AbortSignal.timeout(30_000),
    }).then((r) => r.json() as Promise<{ data?: { id?: string; username?: string } }>);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: expiry(data.expires_in),
      accountId: me.data?.id ?? null,
      accountName: me.data?.username ? `@${me.data.username}` : null,
    };
  }

  if (platform === 'LINKEDIN') {
    const data = await tokenRequest<TokenResponse>('https://www.linkedin.com/oauth/v2/accessToken', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri('LINKEDIN'),
      client_id: id ?? '',
      client_secret: secret ?? '',
    });
    if (!data.access_token) throw new Error('LinkedIn did not return a token.');
    const me = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` },
      signal: AbortSignal.timeout(30_000),
    }).then((r) => r.json() as Promise<{ sub?: string; name?: string }>);
    if (!me.sub) throw new Error('LinkedIn did not return the member id.');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: expiry(data.expires_in),
      accountId: me.sub,
      accountName: me.name ?? null,
    };
  }

  const url = (extra: Record<string, string>) => {
    const u = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    u.searchParams.set('client_id', id ?? '');
    u.searchParams.set('client_secret', secret ?? '');
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return u;
  };
  const get = async (u: URL) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    const data = (await r.json().catch(() => ({}))) as TokenResponse & { error?: { message?: string } };
    if (!r.ok || data.error) throw new Error(`Facebook OAuth: ${data.error?.message ?? r.status}`);
    return data;
  };
  const short = await get(url({ redirect_uri: redirectUri('FACEBOOK'), code }));
  const long = await get(url({ grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token ?? '' }));
  if (!long.access_token) throw new Error('Facebook did not return a token.');
  const pages = await graph<{ data?: FacebookPage[] }>(
    'me/accounts?fields=id,name,access_token',
    undefined,
    long.access_token,
  );
  const list = pages.data ?? [];
  const page = list[0];
  if (!page) throw new Error('No Facebook Page found on this account.');
  // Page tokens derived from a long-lived user token do not expire.
  return {
    accessToken: page.access_token,
    refreshToken: null,
    expiresAt: null,
    accountId: page.id,
    accountName: page.name,
    pages: list,
  };
}

export async function refreshXToken(refreshToken: string) {
  const { id, secret } = credentials('X');
  const data = await tokenRequest<TokenResponse>(
    'https://api.x.com/2/oauth2/token',
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: id ?? '' },
    secret ? { id: id ?? '', secret } : undefined,
  );
  if (!data.access_token) throw new Error('X did not return a token.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresAt: expiry(data.expires_in) };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

import { appBaseUrl } from '@/lib/ads/customer-oauth';

/** Platforms this module connects itself; the rest reuse the project-marketing connections. */
export type VideoConnectPlatform = 'YOUTUBE' | 'TIKTOK';

export const VIDEO_RETURN_PATH = '/app/studio/video/schedule';
const STATE_TTL_MS = 10 * 60 * 1000;

export function isVideoConnectPlatform(value: string): value is VideoConnectPlatform {
  return value === 'YOUTUBE' || value === 'TIKTOK';
}

function credentials(platform: VideoConnectPlatform) {
  return platform === 'YOUTUBE'
    ? { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
    : { id: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET };
}

export function isVideoConnectConfigured(platform: VideoConnectPlatform) {
  const { id, secret } = credentials(platform);
  return Boolean(id?.trim() && secret?.trim());
}

export const videoRedirectUri = (platform: VideoConnectPlatform) =>
  `${appBaseUrl()}/api/video-release/callback/${platform.toLowerCase()}`;

const sign = (platform: VideoConnectPlatform, payload: string) =>
  createHmac('sha256', credentials(platform).secret ?? '')
    .update(`vr:${platform}:${payload}`)
    .digest('hex');

/** Signed, expiring state binds the callback to the user who started it. */
export function createVideoState(platform: VideoConnectPlatform, userId: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: now })).toString('base64url');
  return `${payload}.${sign(platform, payload)}`;
}

export function verifyVideoState(platform: VideoConnectPlatform, state: string | null, now = Date.now()): string | null {
  if (!state) return null;
  const [payload, signature, ...rest] = state.split('.');
  if (!payload || !signature || rest.length) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(platform, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const age = now - Number(t);
    return typeof u === 'string' && age >= 0 && age <= STATE_TTL_MS ? u : null;
  } catch {
    return null;
  }
}

export function videoAuthorizeUrl(platform: VideoConnectPlatform, state: string) {
  const { id } = credentials(platform);
  if (platform === 'YOUTUBE') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', id ?? '');
    url.searchParams.set('redirect_uri', videoRedirectUri(platform));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return url.toString();
  }
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', id ?? '');
  url.searchParams.set('redirect_uri', videoRedirectUri(platform));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic,video.publish,video.upload');
  url.searchParams.set('state', state);
  return url.toString();
}

export type VideoTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountName: string | null;
  accountId: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  error?: string | { message?: string };
  error_description?: string;
};

const expiry = (seconds?: number) => (seconds ? new Date(Date.now() + seconds * 1000) : null);

async function tokenRequest(url: string, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || data.error) {
    const detail = data.error_description ?? (typeof data.error === 'string' ? data.error : data.error?.message ?? '');
    throw new Error(`OAuth token request failed (${response.status}): ${detail}`);
  }
  return data;
}

export async function exchangeVideoCode(platform: VideoConnectPlatform, code: string): Promise<VideoTokens> {
  const { id, secret } = credentials(platform);
  if (platform === 'YOUTUBE') {
    const data = await tokenRequest('https://oauth2.googleapis.com/token', {
      code,
      client_id: id ?? '',
      client_secret: secret ?? '',
      redirect_uri: videoRedirectUri(platform),
      grant_type: 'authorization_code',
    });
    if (!data.access_token) throw new Error('Google did not return a token.');
    const channel = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${data.access_token}` },
      signal: AbortSignal.timeout(30_000),
    }).then((r) => r.json() as Promise<{ items?: { id?: string; snippet?: { title?: string } }[] }>);
    const item = channel.items?.[0];
    if (!item?.id) throw new Error('No YouTube channel found on this Google account.');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: expiry(data.expires_in),
      accountId: item.id,
      accountName: item.snippet?.title ?? null,
    };
  }

  const data = await tokenRequest('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: id ?? '',
    client_secret: secret ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: videoRedirectUri(platform),
  });
  if (!data.access_token) throw new Error('TikTok did not return a token.');
  const me = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
    headers: { Authorization: `Bearer ${data.access_token}` },
    signal: AbortSignal.timeout(30_000),
  })
    .then((r) => r.json() as Promise<{ data?: { user?: { open_id?: string; display_name?: string } } }>)
    .catch(() => ({ data: undefined }));
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: expiry(data.expires_in),
    accountId: me.data?.user?.open_id ?? data.open_id ?? null,
    accountName: me.data?.user?.display_name ?? null,
  };
}

export async function refreshVideoToken(platform: VideoConnectPlatform, refreshToken: string) {
  const { id, secret } = credentials(platform);
  const data =
    platform === 'YOUTUBE'
      ? await tokenRequest('https://oauth2.googleapis.com/token', {
          client_id: id ?? '',
          client_secret: secret ?? '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        })
      : await tokenRequest('https://open.tiktokapis.com/v2/oauth/token/', {
          client_key: id ?? '',
          client_secret: secret ?? '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        });
  if (!data.access_token) throw new Error('The platform did not return a token.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresAt: expiry(data.expires_in) };
}

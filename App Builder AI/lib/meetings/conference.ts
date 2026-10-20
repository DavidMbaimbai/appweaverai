import { prisma } from '@/lib/prisma';
import { getVerifiedConnection } from '@/lib/calendar/service';
import { isHttpsUrl, type LocationKind } from './logic';

export type ConferenceStatus = { kind: LocationKind; available: boolean; reason: string | null };
export type ConferenceLink = { url: string; id: string | null; provider: string };

/**
 * Conference providers. GOOGLE_MEET and TEAMS are created together with the calendar event (see service.ts) and are
 * only AVAILABLE when the matching calendar connection is verified. ZOOM uses server-to-server OAuth and is only
 * AVAILABLE after a live verification call. Links are never fabricated: a provider either returns one or we
 * fall back to a manual link entered by the organiser.
 */
export interface ConferenceProvider {
  kind: 'ZOOM';
  configured(): boolean;
  verify(): Promise<{ ok: true } | { ok: false; error: string }>;
  create(input: { topic: string; start: Date; durationMin: number; timeZone: string }): Promise<ConferenceLink>;
  remove(id: string): Promise<void>;
}

const ZOOM_VERIFY_MAX_AGE_MS = 48 * 3600_000;

const zoomEnv = () => ({
  accountId: process.env.ZOOM_ACCOUNT_ID?.trim(),
  clientId: process.env.ZOOM_CLIENT_ID?.trim(),
  clientSecret: process.env.ZOOM_CLIENT_SECRET?.trim(),
});

async function zoomToken(): Promise<string> {
  const { accountId, clientId, clientSecret } = zoomEnv();
  if (!accountId || !clientId || !clientSecret) throw new Error('Zoom credentials are not configured.');
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !json.access_token) throw new Error(`Zoom token request failed (${res.status}).`);
  return json.access_token;
}

export const zoomProvider: ConferenceProvider = {
  kind: 'ZOOM',
  configured: () => {
    const e = zoomEnv();
    return Boolean(e.accountId && e.clientId && e.clientSecret);
  },
  async verify() {
    try {
      const token = await zoomToken();
      const res = await fetch('https://api.zoom.us/v2/users/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      return res.ok ? { ok: true } : { ok: false, error: `Zoom verification failed (${res.status}).` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Zoom verification failed.' };
    }
  },
  async create({ topic, start, durationMin, timeZone }) {
    const token = await zoomToken();
    const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic.slice(0, 200), type: 2, start_time: start.toISOString().replace(/\.\d{3}Z$/, 'Z'), duration: durationMin, timezone: timeZone }),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { id?: number | string; join_url?: string };
    if (!res.ok) throw new Error(`Zoom meeting creation failed (${res.status}).`);
    if (!isHttpsUrl(json.join_url)) throw new Error('Zoom did not return a join link.');
    return { url: json.join_url, id: json.id != null ? String(json.id) : null, provider: 'ZOOM' };
  },
  async remove(id) {
    const token = await zoomToken();
    const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok && res.status !== 404) throw new Error(`Zoom meeting deletion failed (${res.status}).`);
  },
};

export async function verifyZoom() {
  const r = await zoomProvider.verify();
  await prisma.meetingProviderStatus.upsert({
    where: { provider: 'ZOOM' },
    create: { provider: 'ZOOM', verifiedAt: r.ok ? new Date() : null, lastError: r.ok ? null : r.error },
    update: { verifiedAt: r.ok ? new Date() : null, lastError: r.ok ? null : r.error },
  });
  return r;
}

export async function conferenceStatus(kind: LocationKind, scopeKey: string, now = new Date()): Promise<ConferenceStatus> {
  if (kind === 'GOOGLE_MEET' || kind === 'TEAMS') {
    const conn = await getVerifiedConnection(scopeKey);
    const want = kind === 'GOOGLE_MEET' ? 'GOOGLE' : 'MICROSOFT';
    if (!conn) return { kind, available: false, reason: 'UNAVAILABLE: no verified calendar connection.' };
    if (conn.provider !== want) return { kind, available: false, reason: `UNAVAILABLE: ${kind === 'GOOGLE_MEET' ? 'Google Meet needs a Google' : 'Teams needs a Microsoft'} calendar connection.` };
    return { kind, available: true, reason: null };
  }
  if (kind === 'ZOOM') {
    if (!zoomProvider.configured()) return { kind, available: false, reason: 'UNAVAILABLE: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET are not set.' };
    const row = await prisma.meetingProviderStatus.findUnique({ where: { provider: 'ZOOM' } });
    if (!row?.verifiedAt || now.getTime() - row.verifiedAt.getTime() > ZOOM_VERIFY_MAX_AGE_MS) {
      return { kind, available: false, reason: 'UNAVAILABLE: Zoom has not passed a live verification call.' };
    }
    return { kind, available: true, reason: null };
  }
  return { kind, available: true, reason: null };
}

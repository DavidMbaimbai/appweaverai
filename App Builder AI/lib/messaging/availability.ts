import { createHash } from 'node:crypto';

import { scopeId, type AgentScope } from '@/lib/agents/types';
import { prisma } from '@/lib/prisma';

import { GRAPH } from './adapters/whatsapp';
import { getCredentials, type SmsCredentials, type WhatsAppCredentials } from './connections';
import type { MessageChannelName } from './types';

/** Channels that need a recorded live verification before they may send. */
export const VERIFIED_CHANNELS: MessageChannelName[] = ['SMS', 'WHATSAPP'];
export const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Availability = { status: 'AVAILABLE' | 'UNAVAILABLE'; reason?: string };

export function credentialFingerprint(creds: unknown): string {
  return createHash('sha256').update(JSON.stringify(creds)).digest('hex');
}

type VerificationRow = { status: string; fingerprint: string; checkedAt: Date; detail?: string | null } | null;

/** Pure: AVAILABLE only with credentials AND a successful, recent verification of those exact credentials. */
export function evaluateAvailability(
  channel: MessageChannelName,
  creds: unknown,
  verification: VerificationRow,
  now: Date = new Date(),
): Availability {
  if (!VERIFIED_CHANNELS.includes(channel)) return { status: 'AVAILABLE' };
  if (!creds) return { status: 'UNAVAILABLE', reason: `${channel} credentials are not set.` };
  if (!verification) return { status: 'UNAVAILABLE', reason: `${channel} has not been verified yet. Run "Verify now" to check the live account.` };
  if (verification.status !== 'VERIFIED') {
    return { status: 'UNAVAILABLE', reason: `Last ${channel} verification failed${verification.detail ? `: ${verification.detail}` : ''}.` };
  }
  if (verification.fingerprint !== credentialFingerprint(creds)) {
    return { status: 'UNAVAILABLE', reason: `${channel} credentials changed since the last verification. Verify again.` };
  }
  if (now.getTime() - verification.checkedAt.getTime() > VERIFICATION_TTL_MS) {
    return { status: 'UNAVAILABLE', reason: `${channel} verification is older than 7 days. Verify again.` };
  }
  return { status: 'AVAILABLE' };
}

export async function getAvailability(scope: AgentScope, channel: MessageChannelName): Promise<Availability> {
  if (!VERIFIED_CHANNELS.includes(channel)) return { status: 'AVAILABLE' };
  const creds = await getCredentials(scope, channel);
  if (!creds) return evaluateAvailability(channel, null, null);
  const verification = await prisma.channelVerification.findUnique({
    where: { scopeType_scopeId_channel: { scopeType: scope.type, scopeId: scopeId(scope), channel } },
  });
  return evaluateAvailability(channel, creds, verification);
}

type LiveResult = { ok: true; detail: string } | { ok: false; detail: string; errorCode?: string };

async function liveCheck(channel: MessageChannelName, creds: unknown): Promise<LiveResult> {
  try {
    if (channel === 'SMS') {
      const c = creds as SmsCredentials;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}` },
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; code?: number; message?: string };
      if (!res.ok) return { ok: false, detail: `Twilio rejected the credentials (HTTP ${res.status}).`, errorCode: String(body.code ?? res.status) };
      if (body.status !== 'active') return { ok: false, detail: `Twilio account status is "${body.status ?? 'unknown'}", not active.` };
      return { ok: true, detail: 'Twilio account is active.' };
    }
    if (channel === 'WHATSAPP') {
      const c = creds as WhatsAppCredentials;
      const res = await fetch(`${GRAPH}/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${c.accessToken}` },
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; display_phone_number?: string; error?: { code?: number; message?: string } };
      if (!res.ok || !body.id) {
        return { ok: false, detail: `WhatsApp phone number lookup failed (HTTP ${res.status}).`, errorCode: String(body.error?.code ?? res.status) };
      }
      return { ok: true, detail: `WhatsApp number ${body.display_phone_number ?? c.phoneNumberId} reachable.` };
    }
    return { ok: true, detail: 'No live check needed.' };
  } catch (error) {
    return { ok: false, detail: `Verification call failed: ${error instanceof Error ? error.message : 'network error'}`.slice(0, 300) };
  }
}

/** Makes the live provider call with the scope's credentials and records the outcome. */
export async function verifyChannel(scope: AgentScope, channel: MessageChannelName): Promise<Availability & { detail: string }> {
  if (!VERIFIED_CHANNELS.includes(channel)) return { status: 'AVAILABLE', detail: 'This channel needs no live verification.' };
  const creds = await getCredentials(scope, channel);
  if (!creds) return { status: 'UNAVAILABLE', reason: `${channel} credentials are not set.`, detail: `${channel} credentials are not set.` };
  const result = await liveCheck(channel, creds);
  const values = {
    status: result.ok ? 'VERIFIED' : 'FAILED',
    fingerprint: credentialFingerprint(creds),
    detail: result.detail.slice(0, 500),
    errorCode: result.ok ? null : (result.errorCode ?? null),
    checkedAt: new Date(),
  };
  await prisma.channelVerification.upsert({
    where: { scopeType_scopeId_channel: { scopeType: scope.type, scopeId: scopeId(scope), channel } },
    create: { scopeType: scope.type, scopeId: scopeId(scope), channel, ...values },
    update: values,
  });
  return result.ok ? { status: 'AVAILABLE', detail: result.detail } : { status: 'UNAVAILABLE', reason: result.detail, detail: result.detail };
}

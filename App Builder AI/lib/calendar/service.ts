import { createHash, randomBytes } from 'node:crypto';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { isValidTimeZone } from '@/lib/ads/schedule';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import type { CalendarConnection, Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { createPkce } from '@/lib/project-marketing/oauth';

import { DEFAULT_WORKING_HOURS, parseWorkingHours, type Interval } from './logic';
import * as provider from './providers';
import { CalendarApiError, CalendarAuthError, calendarCredentials, isCalendarProvider, type CalendarProviderName } from './providers';

export const PLATFORM_SCOPE_KEY = 'PLATFORM';
const STATE_TTL_MS = 10 * 60_000;
/** A connection must have passed a live call this recently to be treated as usable. */
export const VERIFICATION_MAX_AGE_MS = 48 * 3600_000;

export const redirectUriFor = (p: CalendarProviderName) => `${appBaseUrl()}/api/calendar/callback/${p.toLowerCase()}`;
const hashState = (s: string) => createHash('sha256').update(s).digest('hex');

export function providerConfigured(p: CalendarProviderName) {
  return calendarCredentials(p) !== null;
}

export const getConnection = (scopeKey: string) => prisma.calendarConnection.findUnique({ where: { scopeKey } });

export function isVerified(conn: CalendarConnection | null, now = new Date()): conn is CalendarConnection {
  return Boolean(
    conn &&
      isCalendarProvider(conn.provider) &&
      providerConfigured(conn.provider) &&
      conn.status === 'CONNECTED' &&
      conn.refreshTokenEnc &&
      conn.verifiedAt &&
      now.getTime() - conn.verifiedAt.getTime() < VERIFICATION_MAX_AGE_MS,
  );
}

export async function getVerifiedConnection(scopeKey: string) {
  const conn = await getConnection(scopeKey);
  return isVerified(conn) ? conn : null;
}

async function markNeedsReconnect(conn: CalendarConnection, reason: string) {
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: { status: 'NEEDS_RECONNECT', accessTokenEnc: null, accessTokenExpiresAt: null, refreshTokenEnc: null, verifiedAt: null, lastError: reason.slice(0, 300) },
  });
}

async function freshAccessToken(conn: CalendarConnection, force = false): Promise<string> {
  if (!isCalendarProvider(conn.provider) || !conn.refreshTokenEnc) throw new CalendarAuthError('Connection has no refresh token.');
  if (!force && conn.accessTokenEnc && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(conn.accessTokenEnc);
  }
  const tokens = await provider.refreshAccessToken(conn.provider, decryptSecret(conn.refreshTokenEnc));
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptSecret(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      // Microsoft rotates refresh tokens; always keep the newest one.
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : conn.refreshTokenEnc,
    },
  });
  return tokens.accessToken;
}

/**
 * Runs a provider call with a valid token. A revoked token or rejected call marks the connection NEEDS_RECONNECT
 * so callers can fall back to manual confirmation instead of pretending the calendar was updated.
 */
export async function withCalendar<T>(conn: CalendarConnection, fn: (token: string, p: CalendarProviderName) => Promise<T>): Promise<T> {
  if (!isCalendarProvider(conn.provider)) throw new CalendarAuthError('Unknown provider.');
  try {
    try {
      return await fn(await freshAccessToken(conn), conn.provider);
    } catch (error) {
      if (!(error instanceof CalendarAuthError) || !conn.refreshTokenEnc) throw error;
      return await fn(await freshAccessToken(conn, true), conn.provider);
    }
  } catch (error) {
    if (error instanceof CalendarAuthError) await markNeedsReconnect(conn, error.message);
    throw error;
  }
}

export async function startConnect(input: { scopeKey: string; userId: string; provider: string; returnTo: string }) {
  if (!isCalendarProvider(input.provider) || !providerConfigured(input.provider)) {
    throw new CalendarApiError('This calendar provider is not configured.', 503);
  }
  const state = randomBytes(32).toString('base64url');
  const pkce = createPkce();
  await prisma.calendarOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.calendarOAuthState.create({
    data: {
      stateHash: hashState(state),
      scopeKey: input.scopeKey,
      userId: input.userId,
      provider: input.provider,
      codeVerifierEnc: encryptSecret(pkce.verifier),
      returnTo: input.returnTo.slice(0, 300),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  return provider.authorizeUrl(input.provider, { state, challenge: pkce.challenge, redirectUri: redirectUriFor(input.provider) });
}

export type ConnectOutcome = { ok: boolean; returnTo: string; error?: string };

/** Single-use state: it is deleted atomically, bound to the signed-in user, then the tokens are verified with a live call. */
export async function completeConnect(input: { state: string | null; code: string | null; userId: string; provider: string }): Promise<ConnectOutcome> {
  const fail = (error: string, returnTo = ''): ConnectOutcome => ({ ok: false, returnTo, error });
  if (!input.state || !input.code || !isCalendarProvider(input.provider)) return fail('Missing authorisation details.');
  const row = await prisma.calendarOAuthState.findUnique({ where: { stateHash: hashState(input.state) } });
  if (!row) return fail('Unknown or expired request.');
  const claimed = await prisma.calendarOAuthState.deleteMany({ where: { id: row.id, expiresAt: { gt: new Date() } } });
  if (claimed.count !== 1) return fail('Unknown or expired request.', row.returnTo);
  if (row.userId !== input.userId || row.provider !== input.provider) return fail('This request belongs to a different user.', row.returnTo);

  try {
    const tokens = await provider.exchangeCode(input.provider, {
      code: input.code,
      verifier: decryptSecret(row.codeVerifierEnc),
      redirectUri: redirectUriFor(input.provider),
    });
    if (!tokens.refreshToken) return fail('The provider did not grant offline access. Reconnect and accept all permissions.', row.returnTo);
    const verified = await provider.verifyConnection(input.provider, tokens.accessToken).then(
      (v) => ({ ok: true as const, label: v.label }),
      (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'verification failed' }),
    );
    const data = {
      ownerId: input.userId,
      provider: input.provider,
      status: verified.ok ? 'CONNECTED' : 'PENDING',
      accessTokenEnc: encryptSecret(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      refreshTokenEnc: encryptSecret(tokens.refreshToken),
      scopes: tokens.scopes,
      accountLabel: verified.ok ? verified.label : null,
      verifiedAt: verified.ok ? new Date() : null,
      lastError: verified.ok ? null : verified.error.slice(0, 300),
    };
    await prisma.calendarConnection.upsert({ where: { scopeKey: row.scopeKey }, create: { scopeKey: row.scopeKey, ...data }, update: data });
    return verified.ok ? { ok: true, returnTo: row.returnTo } : fail('Connected, but the live verification call failed.', row.returnTo);
  } catch (error) {
    console.error('[calendar] connect failed:', error instanceof Error ? error.message : error);
    return fail('Could not complete the connection.', row.returnTo);
  }
}

/** Re-runs the live call; used by the Verify button and the poll cron. */
export async function verifyNow(scopeKey: string) {
  const conn = await getConnection(scopeKey);
  if (!conn || !conn.refreshTokenEnc || !isCalendarProvider(conn.provider)) return { ok: false as const, error: 'Not connected.' };
  try {
    const { label } = await withCalendar(conn, (token, p) => provider.verifyConnection(p, token));
    await prisma.calendarConnection.update({ where: { id: conn.id }, data: { status: 'CONNECTED', verifiedAt: new Date(), accountLabel: label, lastError: null } });
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed.';
    if (!(error instanceof CalendarAuthError)) await prisma.calendarConnection.update({ where: { id: conn.id }, data: { verifiedAt: null, lastError: message.slice(0, 300) } });
    return { ok: false as const, error: message };
  }
}

/** Deletes every stored token; the provider grant is revoked best-effort. */
export async function disconnect(scopeKey: string) {
  const conn = await getConnection(scopeKey);
  if (!conn) return;
  if (conn.provider === 'GOOGLE' && conn.refreshTokenEnc) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(conn.refreshTokenEnc))}`, { method: 'POST' });
    } catch {
      // The local tokens are deleted regardless.
    }
  }
  await prisma.calendarConnection.delete({ where: { id: conn.id } });
}

export type CalendarSettings = {
  workingHours?: unknown;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  minNoticeMin?: number;
  slotStepMin?: number;
  durationMin?: number;
  timeZone?: string;
};

export async function saveSettings(scopeKey: string, s: CalendarSettings): Promise<{ ok: true } | { ok: false; error: string }> {
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
  const hours = s.workingHours === undefined ? undefined : parseWorkingHours(s.workingHours);
  if (s.workingHours !== undefined && !hours) return { ok: false, error: 'Working hours are invalid.' };
  if (s.timeZone !== undefined && !isValidTimeZone(s.timeZone)) return { ok: false, error: 'Unknown time zone.' };
  const conn = await getConnection(scopeKey);
  if (!conn) return { ok: false, error: 'Connect a calendar first.' };
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      workingHours: hours ? (hours as Prisma.InputJsonValue) : undefined,
      bufferBeforeMin: int(s.bufferBeforeMin, 0, 240),
      bufferAfterMin: int(s.bufferAfterMin, 0, 240),
      minNoticeMin: int(s.minNoticeMin, 0, 60 * 24 * 30),
      slotStepMin: int(s.slotStepMin, 5, 240),
      durationMin: int(s.durationMin, 5, 480),
      timeZone: s.timeZone,
    },
  });
  return { ok: true };
}

export function connectionRules(conn: CalendarConnection) {
  return {
    timeZone: conn.timeZone,
    workingHours: parseWorkingHours(conn.workingHours) ?? DEFAULT_WORKING_HOURS,
    durationMin: conn.durationMin,
    stepMin: conn.slotStepMin,
    bufferBeforeMin: conn.bufferBeforeMin,
    bufferAfterMin: conn.bufferAfterMin,
    minNoticeMin: conn.minNoticeMin,
  };
}

/** Free/busy from the connected calendar. Throws on failure: callers must not guess availability. */
export async function busyIntervals(conn: CalendarConnection, range: Interval): Promise<Interval[]> {
  return withCalendar(conn, (token, p) => provider.fetchBusy(p, token, range, conn.calendarId));
}

export type CalendarStatus = {
  /** AVAILABLE only when credentials are set AND a connection passed a live verification call. */
  integration: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  providers: Record<CalendarProviderName, { configured: boolean }>;
  connection: null | {
    provider: string;
    status: string;
    accountLabel: string | null;
    verifiedAt: string | null;
    lastError: string | null;
    lastSyncAt: string | null;
    settings: ReturnType<typeof connectionRules>;
  };
};

export async function calendarStatus(scopeKey: string): Promise<CalendarStatus> {
  const providers = { GOOGLE: { configured: providerConfigured('GOOGLE') }, MICROSOFT: { configured: providerConfigured('MICROSOFT') } };
  const conn = await getConnection(scopeKey);
  let reason: string | null = null;
  if (!providers.GOOGLE.configured && !providers.MICROSOFT.configured) reason = 'Calendar credentials are not configured on this server.';
  else if (!conn) reason = 'No calendar connected.';
  else if (conn.status === 'NEEDS_RECONNECT') reason = 'The calendar connection was revoked or expired. Reconnect it.';
  else if (conn.verifiedAt === null || !isVerified(conn)) reason = conn.lastError ?? 'The connection has not passed a live verification.';
  return {
    integration: reason ? 'UNAVAILABLE' : 'AVAILABLE',
    reason,
    providers,
    connection: conn
      ? {
          provider: conn.provider,
          status: conn.status,
          accountLabel: conn.accountLabel,
          verifiedAt: conn.verifiedAt?.toISOString() ?? null,
          lastError: conn.lastError,
          lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
          settings: connectionRules(conn),
        }
      : null,
  };
}

/** Serialises booking decisions per scope (Postgres advisory lock held for the transaction). */
export async function withScopeLock<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return fn(tx);
    },
    { timeout: 25_000, maxWait: 10_000 },
  );
}

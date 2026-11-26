import { randomBytes, randomInt } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { generateRawToken, hashToken } from '@/lib/crypto/token-hash';

/** How long a device/user code pair stays valid before it must be restarted. */
const DEVICE_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
/** Minimum seconds the CLI should wait between polls, per RFC 8628. */
const POLL_INTERVAL_SECONDS = 5;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Unambiguous charset (no 0/O/1/I) for user-facing codes.
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateUserCode(): string {
  const part = () =>
    Array.from({ length: 4 }, () =>
      USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)],
    ).join('');
  return `${part()}-${part()}`;
}

function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url');
}

export type DeviceAuthorizationStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

function verificationBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    'http://localhost:3000'
  );
}

/** Starts a new device-authorization flow; called by the CLI to begin login. */
export async function startDeviceAuthorization(
  clientName?: string,
): Promise<DeviceAuthorizationStart> {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);

  await prisma.cliDeviceAuthorization.create({
    data: {
      deviceCode,
      userCode,
      clientName: clientName?.slice(0, 100),
      interval: POLL_INTERVAL_SECONDS,
      expiresAt,
    },
  });

  const base = verificationBaseUrl();
  const verificationUri = `${base}/app/cli/activate`;

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  };
}

export type PendingDeviceAuthorization = {
  userCode: string;
  clientName: string | null;
  expiresAt: Date;
};

/** Looks up a pending (not yet decided, not expired) device authorization by its user code. */
export async function findPendingDeviceAuthorizationByUserCode(
  userCode: string,
): Promise<PendingDeviceAuthorization | null> {
  const normalized = userCode.trim().toUpperCase();
  const record = await prisma.cliDeviceAuthorization.findUnique({
    where: { userCode: normalized },
    select: { userCode: true, clientName: true, status: true, expiresAt: true },
  });

  if (!record || record.status !== 'PENDING' || record.expiresAt < new Date()) {
    return null;
  }

  return {
    userCode: record.userCode,
    clientName: record.clientName,
    expiresAt: record.expiresAt,
  };
}

/** Approves a pending device authorization on behalf of the signed-in user. */
export async function approveDeviceAuthorization(
  userCode: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = userCode.trim().toUpperCase();
  const record = await prisma.cliDeviceAuthorization.findUnique({
    where: { userCode: normalized },
  });

  if (!record) {
    return { ok: false, error: 'This code was not found. Double-check it in your CLI.' };
  }
  if (record.expiresAt < new Date()) {
    return { ok: false, error: 'This code has expired. Restart the login in your CLI.' };
  }
  if (record.status !== 'PENDING') {
    return { ok: false, error: 'This code has already been used.' };
  }

  await prisma.cliDeviceAuthorization.update({
    where: { id: record.id },
    data: { status: 'APPROVED', userId },
  });

  return { ok: true };
}

/** Denies a pending device authorization on behalf of the signed-in user. */
export async function denyDeviceAuthorization(
  userCode: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = userCode.trim().toUpperCase();
  const record = await prisma.cliDeviceAuthorization.findUnique({
    where: { userCode: normalized },
  });

  if (!record || record.status !== 'PENDING') {
    return { ok: false, error: 'This code was not found or already used.' };
  }

  await prisma.cliDeviceAuthorization.update({
    where: { id: record.id },
    data: { status: 'DENIED', userId },
  });

  return { ok: true };
}

export type DeviceTokenResult =
  | { status: 'authorization_pending' }
  | { status: 'slow_down' }
  | { status: 'access_denied' }
  | { status: 'expired_token' }
  | {
      status: 'approved';
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: 'Bearer';
      user: { id: string; name: string | null; email: string | null };
    };

/** Polled by the CLI with the device_code to complete login once approved. */
export async function exchangeDeviceCodeForToken(
  deviceCode: string,
): Promise<DeviceTokenResult> {
  const record = await prisma.cliDeviceAuthorization.findUnique({
    where: { deviceCode },
  });

  if (!record) {
    return { status: 'expired_token' };
  }

  if (record.expiresAt < new Date()) {
    if (record.status === 'PENDING') {
      await prisma.cliDeviceAuthorization.update({
        where: { id: record.id },
        data: { status: 'EXPIRED' },
      });
    }
    return { status: 'expired_token' };
  }

  if (record.status === 'PENDING') {
    return { status: 'authorization_pending' };
  }

  if (record.status === 'DENIED') {
    return { status: 'access_denied' };
  }

  if (record.status === 'EXPIRED') {
    return { status: 'expired_token' };
  }

  // APPROVED: issue the token exactly once, then consume this row so it
  // can never be redeemed again.
  if (!record.userId) {
    return { status: 'expired_token' };
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    return { status: 'expired_token' };
  }

  const rawToken = generateRawToken();
  const rawRefreshToken = generateRawToken();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const familyId = randomBytes(16).toString('hex');
  await prisma.$transaction([
    prisma.cliToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        name: record.clientName ?? undefined,
        expiresAt: accessExpiresAt,
      },
    }),
    prisma.cliRefreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
      },
    }),
    prisma.cliDeviceAuthorization.update({
      where: { id: record.id },
      data: { status: 'EXPIRED' },
    }),
  ]);

  return {
    status: 'approved',
    accessToken: rawToken,
    refreshToken: rawRefreshToken,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    tokenType: 'Bearer',
    user,
  };
}

/** Validates a CLI bearer token and returns the authenticated user, if any. */
export async function getCliSessionUser(
  authorizationHeader: string | null,
): Promise<{ id: string; name: string | null; email: string | null } | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }
  const rawToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!rawToken) {
    return null;
  }

  const tokenHash = hashToken(rawToken);
  const token = await prisma.cliToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < new Date())) {
    return null;
  }

  // Best-effort; failure to record last-used shouldn't block the request.
  void prisma.cliToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return token.user;
}

export type RefreshTokenResult =
  | {
      status: 'approved';
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: 'Bearer';
      user: { id: string; name: string | null; email: string | null };
    }
  | { status: 'invalid_grant' };

/** Rotates a refresh token and invalidates the token that was presented. */
export async function rotateCliRefreshToken(
  rawRefreshToken: string,
): Promise<RefreshTokenResult> {
  const stored = await prisma.cliRefreshToken.findUnique({
    where: { tokenHash: hashToken(rawRefreshToken) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (
    !stored ||
    stored.revokedAt ||
    stored.replacedAt ||
    stored.expiresAt < new Date()
  ) {
    if (stored?.replacedAt) {
      await prisma.cliRefreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { status: 'invalid_grant' };
  }

  const accessToken = generateRawToken();
  const refreshToken = generateRawToken();
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.cliToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashToken(accessToken),
        name: 'IDE companion',
        expiresAt: accessExpiresAt,
      },
    }),
    prisma.cliRefreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashToken(refreshToken),
        familyId: stored.familyId,
        expiresAt: refreshExpiresAt,
      },
    }),
    prisma.cliRefreshToken.update({
      where: { id: stored.id },
      data: { replacedAt: now, revokedAt: now },
    }),
  ]);

  return {
    status: 'approved',
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    tokenType: 'Bearer',
    user: stored.user,
  };
}

/** Revokes a CLI token belonging to the given user (e.g. from account settings). */
export async function revokeCliToken(tokenId: string, userId: string) {
  await prisma.cliToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function listCliTokens(userId: string) {
  return prisma.cliToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });
}

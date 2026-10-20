import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import { refreshXToken } from '@/lib/project-marketing/oauth';

import { refreshVideoToken } from './oauth';

export type ConnectionRow = {
  id: string;
  platform: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
};

/**
 * A usable access token, refreshing when it is about to expire.
 * Returns null when the owner has to reconnect (expired and not refreshable, or refresh refused).
 */
export async function usableToken(connection: ConnectionRow): Promise<string | null> {
  const expiresSoon = connection.expiresAt && connection.expiresAt.getTime() < Date.now() + 5 * 60_000;
  if (!expiresSoon) return decryptSecret(connection.accessTokenEnc);
  if (!connection.refreshTokenEnc) return null;
  try {
    const refresh = decryptSecret(connection.refreshTokenEnc);
    const next =
      connection.platform === 'X'
        ? await refreshXToken(refresh)
        : connection.platform === 'YOUTUBE' || connection.platform === 'TIKTOK'
          ? await refreshVideoToken(connection.platform, refresh)
          : null;
    if (!next) return null;
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptSecret(next.accessToken),
        refreshTokenEnc: next.refreshToken ? encryptSecret(next.refreshToken) : null,
        expiresAt: next.expiresAt,
      },
    });
    return next.accessToken;
  } catch (error) {
    console.error('[video-release] token refresh failed:', error);
    return null;
  }
}

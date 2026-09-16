import { prisma } from './prisma';
import { encryptSecret } from './crypto/secret-box';
import { fetchGithubViewer, GithubApiError } from './integrations/github';

export async function getUserGithubConnectionStatus(userId: string) {
  const connection = await prisma.userGithubConnection.findUnique({
    where: { userId },
    select: { githubUsername: true, createdAt: true },
  });

  if (!connection) return { connected: false as const };

  return {
    connected: true as const,
    githubUsername: connection.githubUsername,
    connectedAt: connection.createdAt.toISOString(),
  };
}

/**
 * Validates a GitHub personal access token (must have at least `repo` scope
 * for private repos, or `public_repo` for public-only) and stores it
 * encrypted, replacing any previous connection for this user.
 */
export async function connectUserGithubAccount(userId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('A GitHub personal access token is required.');
  }

  let viewer;
  try {
    viewer = await fetchGithubViewer(trimmed);
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 401) {
      throw new Error('That token was rejected by GitHub. Please check it and try again.');
    }
    throw new Error('Could not verify that token with GitHub.');
  }

  await prisma.userGithubConnection.upsert({
    where: { userId },
    create: {
      userId,
      githubUsername: viewer.login,
      encryptedAccessToken: encryptSecret(trimmed),
    },
    update: {
      githubUsername: viewer.login,
      encryptedAccessToken: encryptSecret(trimmed),
    },
  });

  return { githubUsername: viewer.login };
}

export async function disconnectUserGithubAccount(userId: string) {
  await prisma.userGithubConnection
    .delete({ where: { userId } })
    .catch(() => null);
}

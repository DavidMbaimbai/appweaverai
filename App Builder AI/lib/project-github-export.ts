import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from './prisma';
import { PROJECT_WORKSPACE_ROOT, listProjectFiles } from './project-files';
import { decryptSecret } from './crypto/secret-box';
import {
  createGithubRepo,
  getGithubRepo,
  pushFilesToGithub,
  GithubApiError,
} from './integrations/github';

const MAX_EXPORTABLE_FILES = 1500;

/** Files under these prefixes are internal bookkeeping and never exported. */
function isExportableFile(filePath: string) {
  return !filePath.includes('/.checkpoints/');
}

async function getDecryptedGithubToken(userId: string) {
  const connection = await prisma.userGithubConnection.findUnique({
    where: { userId },
    select: { encryptedAccessToken: true, githubUsername: true },
  });

  if (!connection) return null;

  return {
    token: decryptSecret(connection.encryptedAccessToken),
    githubUsername: connection.githubUsername,
  };
}

async function readAllProjectFiles(projectId: string) {
  const dbFiles = await listProjectFiles(projectId);
  const exportable = dbFiles.filter((file) => isExportableFile(file.path));

  const files: { path: string; content: string }[] = [];
  for (const file of exportable.slice(0, MAX_EXPORTABLE_FILES)) {
    const absolute = path.join(PROJECT_WORKSPACE_ROOT, projectId, file.path);
    try {
      const content = await readFile(absolute, 'utf8');
      files.push({ path: file.path, content });
    } catch {
      // Skip files that no longer exist on disk (stale DB row); best-effort export.
    }
  }

  return files;
}

export type GithubExportResult = {
  repoOwner: string;
  repoName: string;
  htmlUrl: string;
  defaultBranch: string;
  fileCount: number;
  commitSha: string;
};

/**
 * Exports (or re-syncs) a project's current files to a GitHub repository.
 * On first export, creates the repo (using `repoName`/`isPrivate`) and
 * records the link; subsequent calls reuse the linked repo and push an
 * updated snapshot as a new commit (force-updating the branch tip), since
 * this is a one-way project export rather than a collaborative git flow.
 */
export async function exportProjectToGithub({
  projectId,
  userId,
  repoName,
  isPrivate = true,
}: {
  projectId: string;
  userId: string;
  repoName?: string;
  isPrivate?: boolean;
}): Promise<GithubExportResult> {
  const connection = await getDecryptedGithubToken(userId);
  if (!connection) {
    throw new Error(
      'Connect your GitHub account first (Account settings → GitHub).',
    );
  }

  const files = await readAllProjectFiles(projectId);
  if (files.length === 0) {
    throw new Error('Build your project before exporting to GitHub.');
  }

  const existingLink = await prisma.projectGithubLink.findUnique({
    where: { projectId },
  });

  let owner: string;
  let repo: string;
  let defaultBranch: string;
  let htmlUrl: string;
  let repoIsPrivate: boolean;

  if (existingLink) {
    owner = existingLink.repoOwner;
    repo = existingLink.repoName;
    defaultBranch = existingLink.defaultBranch;
    htmlUrl = existingLink.htmlUrl;
    repoIsPrivate = existingLink.private;
  } else {
    const name = (repoName ?? '').trim();
    if (!name) {
      throw new Error('A repository name is required.');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error(
        'Repository name can only contain letters, numbers, dots, dashes, and underscores.',
      );
    }

    const created = await createGithubRepo(connection.token, {
      name,
      private: isPrivate,
      description: 'Exported from AppWeaverAI',
    }).catch((error) => {
      if (error instanceof GithubApiError && error.status === 422) {
        throw new Error(
          `A repository named "${name}" already exists on your GitHub account.`,
        );
      }
      throw error;
    });

    owner = created.owner;
    repo = created.name;
    defaultBranch = created.defaultBranch || 'main';
    htmlUrl = created.htmlUrl;
    repoIsPrivate = created.private;
  }

  // Re-check the repo still exists/is reachable in case it was deleted or
  // renamed on GitHub since the last sync.
  if (existingLink) {
    const stillExists = await getGithubRepo(connection.token, owner, repo);
    if (!stillExists) {
      throw new Error(
        `The linked repository ${owner}/${repo} could not be found on GitHub. It may have been deleted or renamed.`,
      );
    }
  }

  const { commitSha } = await pushFilesToGithub(connection.token, {
    owner,
    repo,
    branch: defaultBranch,
    files,
    message: existingLink
      ? 'Sync from AppWeaverAI'
      : 'Initial export from AppWeaverAI',
  });

  await prisma.projectGithubLink.upsert({
    where: { projectId },
    create: {
      projectId,
      repoOwner: owner,
      repoName: repo,
      repoFullName: `${owner}/${repo}`,
      defaultBranch,
      htmlUrl,
      private: repoIsPrivate,
      connectedById: userId,
      lastSyncedAt: new Date(),
      lastSyncedById: userId,
    },
    update: {
      lastSyncedAt: new Date(),
      lastSyncedById: userId,
    },
  });

  return {
    repoOwner: owner,
    repoName: repo,
    htmlUrl,
    defaultBranch,
    fileCount: files.length,
    commitSha,
  };
}

export async function getProjectGithubLink(projectId: string) {
  return prisma.projectGithubLink.findUnique({
    where: { projectId },
    select: {
      repoOwner: true,
      repoName: true,
      repoFullName: true,
      htmlUrl: true,
      defaultBranch: true,
      private: true,
      lastSyncedAt: true,
    },
  });
}

export async function disconnectProjectGithubLink(projectId: string) {
  await prisma.projectGithubLink.delete({ where: { projectId } }).catch(() => null);
}

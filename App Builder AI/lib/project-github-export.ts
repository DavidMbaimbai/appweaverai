import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from './prisma';
import { PROJECT_WORKSPACE_ROOT, listProjectFiles } from './project-files';
import { decryptSecret } from './crypto/secret-box';
import {
  createGithubRepo,
  getGithubRepo,
  gitBlobSha,
  pushFilesToGithub,
  pushIncrementalChangesToGithub,
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
  commitSha: string | null;
  noChanges?: boolean;
};

export type GithubDiffResult = {
  hasLink: boolean;
  added: string[];
  changed: string[];
  deleted: string[];
};

/**
 * Compares the project's current files against the blob SHAs recorded from
 * the last successful import/push (`ProjectGithubSyncedFile`) to determine
 * what would be pushed next, without pushing anything.
 */
export async function computeGithubDiff(
  projectId: string,
): Promise<GithubDiffResult> {
  const link = await prisma.projectGithubLink.findUnique({
    where: { projectId },
  });

  if (!link) {
    return { hasLink: false, added: [], changed: [], deleted: [] };
  }

  const files = await readAllProjectFiles(projectId);
  const syncedFiles = await prisma.projectGithubSyncedFile.findMany({
    where: { projectId },
    select: { path: true, blobSha: true },
  });

  const syncedShaByPath = new Map(
    syncedFiles.map((file) => [file.path, file.blobSha]),
  );
  const currentPaths = new Set(files.map((file) => file.path));

  const shaEntries = await Promise.all(
    files.map(async (file) => [file.path, await gitBlobSha(file.content)] as const),
  );

  const added: string[] = [];
  const changed: string[] = [];
  for (const [filePath, sha] of shaEntries) {
    const previousSha = syncedShaByPath.get(filePath);
    if (previousSha === undefined) {
      added.push(filePath);
    } else if (previousSha !== sha) {
      changed.push(filePath);
    }
  }

  const deleted = syncedFiles
    .map((file) => file.path)
    .filter((filePath) => !currentPaths.has(filePath));

  return { hasLink: true, added, changed, deleted };
}

async function replaceSyncedFileSnapshot(
  projectId: string,
  blobShas: Record<string, string>,
  deletedPaths: string[],
) {
  await prisma.$transaction([
    prisma.projectGithubSyncedFile.deleteMany({
      where: { projectId, path: { in: deletedPaths } },
    }),
    ...Object.entries(blobShas).map(([filePath, blobSha]) =>
      prisma.projectGithubSyncedFile.upsert({
        where: { projectId_path: { projectId, path: filePath } },
        create: { projectId, path: filePath, blobSha },
        update: { blobSha },
      }),
    ),
  ]);
}

/**
 * Exports (or re-syncs) a project's current files to a GitHub repository.
 * On first export, creates the repo (using `repoName`/`isPrivate`) and
 * pushes a full snapshot as the initial commit. Subsequent calls reuse the
 * linked repo and push only the files that changed since the last
 * successful sync (diffed via git blob SHAs), as a real incremental commit
 * on top of the branch tip — a fast-forward-only push that fails with a
 * clear error if the remote branch has diverged (no merge logic).
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

  let commitSha: string | null;
  let blobShas: Record<string, string>;
  let fileCount: number;
  const noChanges = false;
  let deletedPaths: string[] = [];

  if (existingLink) {
    const syncedFiles = await prisma.projectGithubSyncedFile.findMany({
      where: { projectId },
      select: { path: true, blobSha: true },
    });
    const syncedShaByPath = new Map(
      syncedFiles.map((file) => [file.path, file.blobSha]),
    );
    const currentPaths = new Set(files.map((file) => file.path));

    const shaEntries = await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        content: file.content,
        sha: await gitBlobSha(file.content),
      })),
    );

    const changedFiles = shaEntries.filter(
      (entry) => syncedShaByPath.get(entry.path) !== entry.sha,
    );
    deletedPaths = syncedFiles
      .map((file) => file.path)
      .filter((filePath) => !currentPaths.has(filePath));

    if (changedFiles.length === 0 && deletedPaths.length === 0) {
      return {
        repoOwner: owner,
        repoName: repo,
        htmlUrl,
        defaultBranch,
        fileCount: 0,
        commitSha: null,
        noChanges: true,
      };
    }

    const pushed = await pushIncrementalChangesToGithub(connection.token, {
      owner,
      repo,
      branch: defaultBranch,
      changedFiles: changedFiles.map((entry) => ({
        path: entry.path,
        content: entry.content,
      })),
      deletedPaths,
      message: 'Sync from AppWeaverAI',
    });

    commitSha = pushed.commitSha;
    blobShas = pushed.blobShas;
    fileCount = changedFiles.length;
  } else {
    const pushed = await pushFilesToGithub(connection.token, {
      owner,
      repo,
      branch: defaultBranch,
      files,
      message: 'Initial export from AppWeaverAI',
    });

    commitSha = pushed.commitSha;
    blobShas = pushed.blobShas;
    fileCount = files.length;
  }

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
      lastSyncedCommitSha: commitSha,
    },
    update: {
      lastSyncedAt: new Date(),
      lastSyncedById: userId,
      lastSyncedCommitSha: commitSha,
    },
  });

  await replaceSyncedFileSnapshot(projectId, blobShas, deletedPaths);

  return {
    repoOwner: owner,
    repoName: repo,
    htmlUrl,
    defaultBranch,
    fileCount,
    commitSha,
    noChanges,
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

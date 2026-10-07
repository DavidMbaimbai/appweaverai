import { prisma } from './prisma';
import { deleteProjectFile, writeProjectFile } from './project-files';
import { decryptSecret } from './crypto/secret-box';
import {
  fetchBlobText,
  fetchRepoTree,
  getBranchHead,
  getGithubRepo,
  listGithubRepos,
  type GithubRepoSummary,
} from './integrations/github';
import { computeGithubDiff, type GithubDiffResult } from './project-github-export';

/** Files under these prefixes/paths are never imported (build output, VCS metadata, deps). */
const IGNORED_PATH_PREFIXES = [
  '.git/',
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  '.vercel/',
  '.turbo/',
];

const MAX_IMPORTABLE_FILE_BYTES = 300 * 1024; // 300KB — skip large binaries/lockfiles-as-data.

function isImportablePath(filePath: string) {
  return !IGNORED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
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

export async function listImportableRepos(
  userId: string,
  options?: { page?: number },
): Promise<{ repos: GithubRepoSummary[]; hasMore: boolean }> {
  const connection = await getDecryptedGithubToken(userId);
  if (!connection) {
    throw new Error(
      'Connect your GitHub account first (Account settings → GitHub).',
    );
  }

  return listGithubRepos(connection.token, { page: options?.page });
}

export type GithubImportResult = {
  repoOwner: string;
  repoName: string;
  htmlUrl: string;
  defaultBranch: string;
  fileCount: number;
  skippedCount: number;
};

type FetchedRepoFile = { path: string; content: string; sha: string };

/**
 * Walks a repo tree, filters out ignored/oversized/binary paths, and fetches
 * the remaining blobs' text content with limited concurrency. Shared by
 * both the initial import and subsequent pulls.
 */
async function fetchRepoFiles(
  token: string,
  owner: string,
  repo: string,
  treeSha: string,
  maxFiles: number,
): Promise<{ files: FetchedRepoFile[]; skippedCount: number }> {
  const { entries } = await fetchRepoTree(token, owner, repo, treeSha);

  const blobEntries = entries.filter(
    (entry) =>
      entry.type === 'blob' &&
      isImportablePath(entry.path) &&
      (entry.size ?? 0) <= MAX_IMPORTABLE_FILE_BYTES,
  );

  const skippedBySize =
    entries.filter((entry) => entry.type === 'blob').length - blobEntries.length;

  const limited = blobEntries.slice(0, maxFiles);

  const CONCURRENCY = 8;
  const files: FetchedRepoFile[] = [];
  let binarySkipped = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < limited.length) {
      const index = cursor;
      cursor += 1;
      const entry = limited[index];
      const content = await fetchBlobText(token, owner, repo, entry.sha);
      if (content === null) {
        binarySkipped += 1;
        continue;
      }
      files.push({ path: entry.path, content, sha: entry.sha });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, limited.length) }, worker),
  );

  return { files, skippedCount: skippedBySize + binarySkipped };
}

/**
 * Imports an existing GitHub repository's files into a project's artifact,
 * then links the project to that repo/branch so future pushes can diff
 * against this imported snapshot (see `ProjectGithubSyncedFile`).
 */
export async function importRepoIntoProject({
  projectId,
  artifactId,
  artifactSlug,
  userId,
  owner,
  repo,
  branch,
  maxFiles = 1500,
}: {
  projectId: string;
  artifactId: string;
  artifactSlug: string;
  userId: string;
  owner: string;
  repo: string;
  branch?: string;
  maxFiles?: number;
}): Promise<GithubImportResult> {
  const connection = await getDecryptedGithubToken(userId);
  if (!connection) {
    throw new Error(
      'Connect your GitHub account first (Account settings → GitHub).',
    );
  }

  const token = connection.token;

  const repoInfo = await getGithubRepo(token, owner, repo);
  if (!repoInfo) {
    throw new Error(`Repository ${owner}/${repo} could not be found.`);
  }

  const targetBranch = branch?.trim() || repoInfo.defaultBranch;
  const head = await getBranchHead(token, owner, repo, targetBranch);
  if (!head) {
    throw new Error(`Branch "${targetBranch}" does not exist on ${owner}/${repo}.`);
  }

  const { files: imported, skippedCount } = await fetchRepoFiles(
    token,
    owner,
    repo,
    head.treeSha,
    maxFiles,
  );

  if (imported.length === 0) {
    throw new Error(
      'No importable text files were found in this repository/branch.',
    );
  }

  for (const file of imported) {
    await writeProjectFile({
      projectId,
      artifactSlug,
      artifactId,
      relativePath: file.path,
      content: file.content,
    });
  }

  await prisma.projectGithubLink.upsert({
    where: { projectId },
    create: {
      projectId,
      repoOwner: owner,
      repoName: repo,
      repoFullName: repoInfo.fullName,
      defaultBranch: targetBranch,
      htmlUrl: repoInfo.htmlUrl,
      private: repoInfo.private,
      connectedById: userId,
      lastSyncedAt: new Date(),
      lastSyncedById: userId,
      lastSyncedCommitSha: head.commitSha,
    },
    update: {
      repoOwner: owner,
      repoName: repo,
      repoFullName: repoInfo.fullName,
      defaultBranch: targetBranch,
      htmlUrl: repoInfo.htmlUrl,
      private: repoInfo.private,
      lastSyncedAt: new Date(),
      lastSyncedById: userId,
      lastSyncedCommitSha: head.commitSha,
    },
  });

  // Replace the synced-file snapshot with exactly what we just imported, so
  // the next push diffs against the true imported state.
  await prisma.$transaction([
    prisma.projectGithubSyncedFile.deleteMany({ where: { projectId } }),
    prisma.projectGithubSyncedFile.createMany({
      data: imported.map((file) => ({
        projectId,
        path: file.path,
        blobSha: file.sha,
      })),
    }),
  ]);

  return {
    repoOwner: owner,
    repoName: repo,
    htmlUrl: repoInfo.htmlUrl,
    defaultBranch: targetBranch,
    fileCount: imported.length,
    skippedCount,
  };
}

export type GithubPullConflict = {
  conflict: true;
  localDiff: GithubDiffResult;
};

export type GithubPullResult = {
  conflict?: false;
  repoOwner: string;
  repoName: string;
  htmlUrl: string;
  defaultBranch: string;
  fileCount: number;
  deletedCount: number;
  skippedCount: number;
  upToDate?: boolean;
};

/**
 * Pulls the latest commit on the linked repo/branch into the project,
 * overwriting local files with the repo's current content and removing any
 * files that were deleted upstream. Refuses to overwrite silently when the
 * project has local changes that haven't been pushed yet (see
 * `computeGithubDiff`) unless `force` is set — the caller is expected to
 * surface that conflict to the user and let them confirm a forced pull.
 */
export async function pullLatestFromGithub({
  projectId,
  artifactId,
  artifactSlug,
  userId,
  force = false,
  maxFiles = 1500,
}: {
  projectId: string;
  artifactId: string;
  artifactSlug: string;
  userId: string;
  force?: boolean;
  maxFiles?: number;
}): Promise<GithubPullConflict | GithubPullResult> {
  const link = await prisma.projectGithubLink.findUnique({
    where: { projectId },
  });
  if (!link) {
    throw new Error('This project is not linked to a GitHub repository yet.');
  }

  const connection = await getDecryptedGithubToken(userId);
  if (!connection) {
    throw new Error(
      'Connect your GitHub account first (Account settings → GitHub).',
    );
  }

  const token = connection.token;
  const { repoOwner: owner, repoName: repo, defaultBranch: branch } = link;

  const repoInfo = await getGithubRepo(token, owner, repo);
  if (!repoInfo) {
    throw new Error(
      `The linked repository ${owner}/${repo} could not be found on GitHub. It may have been deleted or renamed.`,
    );
  }

  const head = await getBranchHead(token, owner, repo, branch);
  if (!head) {
    throw new Error(`Branch "${branch}" does not exist on ${owner}/${repo}.`);
  }

  if (!force) {
    const localDiff = await computeGithubDiff(projectId);
    if (
      localDiff.added.length > 0 ||
      localDiff.changed.length > 0 ||
      localDiff.deleted.length > 0
    ) {
      return { conflict: true, localDiff };
    }
  }

  if (head.commitSha === link.lastSyncedCommitSha) {
    return {
      repoOwner: owner,
      repoName: repo,
      htmlUrl: repoInfo.htmlUrl,
      defaultBranch: branch,
      fileCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      upToDate: true,
    };
  }

  const { files: pulled, skippedCount } = await fetchRepoFiles(
    token,
    owner,
    repo,
    head.treeSha,
    maxFiles,
  );

  const previouslySynced = await prisma.projectGithubSyncedFile.findMany({
    where: { projectId },
    select: { path: true },
  });
  const pulledPaths = new Set(pulled.map((file) => file.path));
  const removedPaths = previouslySynced
    .map((file) => file.path)
    .filter((filePath) => !pulledPaths.has(filePath));

  for (const file of pulled) {
    await writeProjectFile({
      projectId,
      artifactSlug,
      artifactId,
      relativePath: file.path,
      content: file.content,
    });
  }

  for (const filePath of removedPaths) {
    await deleteProjectFile({ projectId, artifactSlug, relativePath: filePath });
  }

  await prisma.projectGithubLink.update({
    where: { projectId },
    data: {
      lastSyncedAt: new Date(),
      lastSyncedById: userId,
      lastSyncedCommitSha: head.commitSha,
    },
  });

  await prisma.$transaction([
    prisma.projectGithubSyncedFile.deleteMany({ where: { projectId } }),
    prisma.projectGithubSyncedFile.createMany({
      data: pulled.map((file) => ({
        projectId,
        path: file.path,
        blobSha: file.sha,
      })),
    }),
  ]);

  return {
    repoOwner: owner,
    repoName: repo,
    htmlUrl: repoInfo.htmlUrl,
    defaultBranch: branch,
    fileCount: pulled.length,
    deletedCount: removedPaths.length,
    skippedCount,
  };
}

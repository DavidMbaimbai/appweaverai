const GITHUB_API_BASE = 'https://api.github.com';

export class GithubApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
  }
}

async function githubFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  return response;
}

async function githubJson<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await githubFetch(token, path, init);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : null) ?? `GitHub API request failed (${response.status}).`;
    throw new GithubApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export type GithubViewer = {
  login: string;
  id: number;
  avatarUrl: string;
};

/** Validates a personal access token and returns the authenticated user. */
export async function fetchGithubViewer(token: string): Promise<GithubViewer> {
  const data = await githubJson<{
    login: string;
    id: number;
    avatar_url: string;
  }>(token, '/user');

  return { login: data.login, id: data.id, avatarUrl: data.avatar_url };
}

export type GithubRepo = {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
};

function toGithubRepo(data: {
  owner: { login: string };
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}): GithubRepo {
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch,
    private: data.private,
  };
}

export type GithubRepoSummary = GithubRepo & {
  description: string | null;
  updatedAt: string;
};

/**
 * Lists repositories the token's owner can access (owned, collaborator, and
 * org repos), most-recently-updated first. Used by the "Import from GitHub"
 * repo picker.
 */
export async function listGithubRepos(
  token: string,
  options?: { page?: number; perPage?: number },
): Promise<{ repos: GithubRepoSummary[]; hasMore: boolean }> {
  const page = options?.page ?? 1;
  const perPage = Math.min(options?.perPage ?? 30, 100);

  const response = await githubFetch(
    token,
    `/user/repos?sort=updated&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`,
  );

  if (!response.ok) {
    throw new GithubApiError(
      'Could not list your GitHub repositories.',
      response.status,
    );
  }

  const data = (await response.json()) as Array<{
    owner: { login: string };
    name: string;
    full_name: string;
    html_url: string;
    default_branch: string;
    private: boolean;
    description: string | null;
    updated_at: string;
  }>;

  const linkHeader = response.headers.get('link') ?? '';
  const hasMore = /rel="next"/.test(linkHeader);

  return {
    repos: data.map((repo) => ({
      ...toGithubRepo(repo),
      description: repo.description,
      updatedAt: repo.updated_at,
    })),
    hasMore,
  };
}

/** Creates a new repository under the authenticated user's account. */
export async function createGithubRepo(
  token: string,
  options: { name: string; private: boolean; description?: string },
): Promise<GithubRepo> {
  const data = await githubJson<{
    owner: { login: string };
    name: string;
    full_name: string;
    html_url: string;
    default_branch: string;
    private: boolean;
  }>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: options.name,
      private: options.private,
      description: options.description,
      auto_init: false,
    }),
  });

  return toGithubRepo(data);
}

/** Fetches an existing repository the token's owner has access to. */
export async function getGithubRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<GithubRepo | null> {
  const response = await githubFetch(token, `/repos/${owner}/${repo}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GithubApiError(
      `Could not look up repository ${owner}/${repo}.`,
      response.status,
    );
  }
  const data = await response.json();
  return toGithubRepo(data);
}

/** Resolves a branch to its current head commit SHA and root tree SHA. */
export async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ commitSha: string; treeSha: string } | null> {
  const refResponse = await githubFetch(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
  );
  if (refResponse.status === 404) return null;
  if (!refResponse.ok) {
    throw new GithubApiError(
      'Could not read the target branch.',
      refResponse.status,
    );
  }

  const refData = await refResponse.json();
  const commitSha = refData.object.sha as string;
  const commitData = await githubJson<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${commitSha}`,
  );

  return { commitSha, treeSha: commitData.tree.sha };
}

export type GithubTreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

/** Recursively lists every blob/tree entry under `treeSha`. */
export async function fetchRepoTree(
  token: string,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<{ entries: GithubTreeEntry[]; truncated: boolean }> {
  const data = await githubJson<{
    tree: Array<{
      path: string;
      type: 'blob' | 'tree' | 'commit';
      sha: string;
      size?: number;
    }>;
    truncated: boolean;
  }>(token, `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);

  return { entries: data.tree, truncated: data.truncated };
}

/**
 * Fetches a blob's content decoded as UTF-8 text. Returns `null` for blobs
 * that don't decode cleanly as UTF-8 text (treated as binary and skipped by
 * importers, since the preview/agent pipeline only works with text files).
 */
export async function fetchBlobText(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<string | null> {
  const data = await githubJson<{ content: string; encoding: string }>(
    token,
    `/repos/${owner}/${repo}/git/blobs/${sha}`,
  );

  if (data.encoding !== 'base64') return null;

  const buffer = Buffer.from(data.content, 'base64');
  // Binary files typically contain a NUL byte; treat that as a signal to
  // skip rather than importing corrupted text.
  if (buffer.includes(0)) return null;

  return buffer.toString('utf8');
}

/** Computes a file's git blob SHA (the same hash `git hash-object` produces). */
export async function gitBlobSha(content: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const contentBuffer = Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${contentBuffer.byteLength}\0`, 'utf8');
  return createHash('sha1')
    .update(Buffer.concat([header, contentBuffer]))
    .digest('hex');
}

type FileToPush = { path: string; content: string };

/** Uploads blobs for `files` with limited concurrency; returns path → blob SHA. */
async function createBlobsForFiles(
  token: string,
  owner: string,
  repo: string,
  files: FileToPush[],
): Promise<Record<string, string>> {
  const CONCURRENCY = 8;
  const blobShas: Record<string, string> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      const file = files[index];
      const blob = await githubJson<{ sha: string }>(
        token,
        `/repos/${owner}/${repo}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: file.content,
            encoding: 'utf-8',
          }),
        },
      );
      blobShas[file.path] = blob.sha;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
  );

  return blobShas;
}

/**
 * Pushes a full snapshot of `files` to `branch` as a single commit using the
 * Git Data API (blobs → tree → commit → ref), creating the branch if it
 * doesn't exist yet (e.g. a brand-new empty repo). This overwrites the
 * branch tip (force-updates the ref) — intended only for the initial export
 * of a brand-new repo link; subsequent syncs use
 * `pushIncrementalChangesToGithub` instead.
 */
export async function pushFilesToGithub(
  token: string,
  options: {
    owner: string;
    repo: string;
    branch: string;
    files: FileToPush[];
    message: string;
  },
): Promise<{ commitSha: string; htmlUrl: string; blobShas: Record<string, string> }> {
  const { owner, repo, branch, files, message } = options;

  if (files.length === 0) {
    throw new Error('Nothing to push — this project has no files yet.');
  }

  const head = await getBranchHead(token, owner, repo, branch);
  const baseCommitSha = head?.commitSha ?? null;
  const baseTreeSha = head?.treeSha;

  const blobShas = await createBlobsForFiles(token, owner, repo, files);

  const tree = await githubJson<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: files.map((file) => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobShas[file.path],
        })),
      }),
    },
  );

  const commit = await githubJson<{ sha: string; html_url: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: baseCommitSha ? [baseCommitSha] : [],
      }),
    },
  );

  if (baseCommitSha) {
    await githubJson(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } else {
    await githubJson(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return {
    commitSha: commit.sha,
    htmlUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    blobShas,
  };
}

/**
 * Pushes only `changedFiles` (added/modified) and removes `deletedPaths`,
 * committing on top of the branch's current tip as a real incremental
 * commit (fast-forward only — fails rather than clobbering history if the
 * remote has moved since the last sync).
 */
export async function pushIncrementalChangesToGithub(
  token: string,
  options: {
    owner: string;
    repo: string;
    branch: string;
    changedFiles: FileToPush[];
    deletedPaths: string[];
    message: string;
  },
): Promise<{ commitSha: string; htmlUrl: string; blobShas: Record<string, string> }> {
  const { owner, repo, branch, changedFiles, deletedPaths, message } = options;

  if (changedFiles.length === 0 && deletedPaths.length === 0) {
    throw new Error('Nothing to push — there are no pending changes.');
  }

  const head = await getBranchHead(token, owner, repo, branch);
  if (!head) {
    throw new Error(
      `Branch "${branch}" does not exist yet on ${owner}/${repo}.`,
    );
  }

  const blobShas = await createBlobsForFiles(token, owner, repo, changedFiles);

  const tree = await githubJson<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: head.treeSha,
        tree: [
          ...changedFiles.map((file) => ({
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blobShas[file.path],
          })),
          // Setting sha: null removes a path from the tree (file deletion).
          ...deletedPaths.map((filePath) => ({
            path: filePath,
            mode: '100644',
            type: 'blob',
            sha: null,
          })),
        ],
      }),
    },
  );

  const commit = await githubJson<{ sha: string; html_url: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [head.commitSha],
      }),
    },
  );

  try {
    await githubJson(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 422) {
      throw new Error(
        `${owner}/${repo}@${branch} has new commits upstream. Re-import the repo to pick up the latest changes before pushing again.`,
      );
    }
    throw error;
  }

  return {
    commitSha: commit.sha,
    htmlUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    blobShas,
  };
}

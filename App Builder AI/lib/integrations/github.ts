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

type FileToPush = { path: string; content: string };

/**
 * Pushes a full snapshot of `files` to `branch` as a single commit using the
 * Git Data API (blobs → tree → commit → ref), creating the branch if it
 * doesn't exist yet (e.g. a brand-new empty repo). This overwrites the
 * branch tip (force-updates the ref), since this is a one-way project
 * export/sync rather than a collaborative git workflow.
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
): Promise<{ commitSha: string; htmlUrl: string }> {
  const { owner, repo, branch, files, message } = options;

  if (files.length === 0) {
    throw new Error('Nothing to push — this project has no files yet.');
  }

  const refResponse = await githubFetch(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
  );

  let baseCommitSha: string | null = null;
  let baseTreeSha: string | undefined;

  if (refResponse.status === 200) {
    const refData = await refResponse.json();
    baseCommitSha = refData.object.sha as string;
    const commitData = await githubJson<{ tree: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`,
    );
    baseTreeSha = commitData.tree.sha;
  } else if (refResponse.status !== 404) {
    throw new GithubApiError(
      'Could not read the target branch.',
      refResponse.status,
    );
  }

  // Create blobs with limited concurrency to avoid hammering the API for
  // projects with a large number of files.
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
  };
}

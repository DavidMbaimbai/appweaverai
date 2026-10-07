'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type GithubRepoOption = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  updatedAt: string | null;
};

type GithubRepoPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (repo: GithubRepoOption, branch: string) => void;
  isSubmitting?: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
};

export function GithubRepoPicker({
  open,
  onClose,
  onSelect,
  isSubmitting = false,
  title = 'Import from GitHub',
  description = 'Choose a repository to bring into AppWeaverAI.',
  confirmLabel = 'Import repository',
}: GithubRepoPickerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepoOption[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<GithubRepoOption | null>(null);
  const [branch, setBranch] = useState('');
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset the picker's state synchronously during render (rather than in an
  // effect) whenever the modal transitions from closed to open, so the
  // fetch effect below starts from a clean slate without a double-render.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setIsLoading(true);
      setLoadError(null);
      setSelected(null);
      setRepos([]);
      setPage(1);
    }
  }

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/account/github/repos?page=1');
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          setLoadError(data.error);
          return;
        }
        setRepos(data.repos ?? []);
        setHasMore(Boolean(data.hasMore));
      } catch {
        if (!cancelled) setLoadError('Could not load GitHub repositories.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function loadMore() {
    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`/api/account/github/repos?page=${nextPage}`);
      const data = await res.json();
      if (data.error) {
        setLoadError(data.error);
        return;
      }
      setRepos((current) => [...current, ...(data.repos ?? [])]);
      setHasMore(Boolean(data.hasMore));
      setPage(nextPage);
    } catch {
      setLoadError('Could not load more repositories.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  function handleSelectRepo(repo: GithubRepoOption) {
    setSelected(repo);
    setBranch(repo.defaultBranch);
  }

  const filteredRepos = repos.filter((repo) =>
    repo.fullName.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">{title}</h2>
            <p className="mt-0.5 text-xs text-app-text-muted">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Loading your repositories…
            </p>
          ) : loadError ? (
            <p className="py-6 text-center text-sm text-appweaver-orange">
              {loadError}
            </p>
          ) : selected ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs text-app-accent hover:underline">
                ← Choose a different repository
              </button>
              <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                <p className="text-sm font-medium text-app-text">
                  {selected.fullName}
                </p>
                <p className="mt-1 text-xs text-app-text-muted">
                  {selected.private ? 'Private' : 'Public'}
                </p>
              </div>
              <label className="block text-xs font-medium text-app-text-secondary">
                Branch
                <Input
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  theme="app"
                  className="mt-1 h-9 w-full"
                />
              </label>
              <Button
                type="button"
                theme="app"
                className="w-full"
                disabled={isSubmitting || !branch.trim()}
                onClick={() => onSelect(selected, branch.trim())}>
                {isSubmitting ? 'Importing…' : confirmLabel}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter repositories…"
                theme="app"
                className="h-9 w-full"
              />
              <div className="space-y-1">
                {filteredRepos.length === 0 ? (
                  <p className="py-6 text-center text-sm text-app-text-muted">
                    No repositories found.
                  </p>
                ) : (
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.fullName}
                      type="button"
                      onClick={() => handleSelectRepo(repo)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text">
                      <span className="truncate">{repo.fullName}</span>
                      {repo.private ? (
                        <span className="ml-2 shrink-0 text-xs text-app-text-muted">
                          Private
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
              {hasMore ? (
                <Button
                  type="button"
                  variant="secondary"
                  theme="app"
                  size="sm"
                  className="w-full"
                  disabled={isLoadingMore}
                  onClick={loadMore}>
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

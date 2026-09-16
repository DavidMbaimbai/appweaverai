'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import Link from 'next/link';

type GithubLink = {
  repoOwner: string;
  repoName: string;
  repoFullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  lastSyncedAt: string | null;
} | null;

type GithubExportPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultRepoName: string;
};

function formatRelativeTime(iso: string | null) {
  if (!iso) return 'never';
  const date = new Date(iso);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export function GithubExportPanel({
  open,
  onClose,
  projectId,
  defaultRepoName,
}: GithubExportPanelProps) {
  const { success, error: toastError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [accountConnected, setAccountConnected] = useState<boolean | null>(
    null,
  );
  const [link, setLink] = useState<GithubLink>(null);
  const [repoName, setRepoName] = useState(defaultRepoName);
  const [isPrivate, setIsPrivate] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const [accountRes, linkRes] = await Promise.all([
          fetch('/api/account/github'),
          fetch(`/api/projects/${projectId}/github`),
        ]);
        const accountData = await accountRes.json();
        const linkData = await linkRes.json();
        if (cancelled) return;
        setAccountConnected(Boolean(accountData.connected));
        setLink(linkData.link ?? null);
      } catch {
        if (!cancelled) toastError('Could not load GitHub export status.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function handleExport() {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName, isPrivate }),
      });
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      success(
        link ? 'Pushed the latest changes to GitHub.' : 'Exported to GitHub.',
      );
      const linkRes = await fetch(`/api/projects/${projectId}/github`);
      const linkData = await linkRes.json();
      setLink(linkData.link ?? null);
    } catch {
      toastError('Could not export to GitHub.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">
              Export to GitHub
            </h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Push your project&apos;s current files to a GitHub repository.
            </p>
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
              Loading…
            </p>
          ) : accountConnected === false ? (
            <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-4 text-sm text-app-text-secondary">
              <p>
                Connect your GitHub account before exporting a project.
              </p>
              <Link
                href="/app/account"
                className="mt-2 inline-block text-sm font-medium text-app-accent hover:underline">
                Go to Account settings →
              </Link>
            </div>
          ) : link ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                <p className="text-sm font-medium text-app-text">
                  {link.repoFullName}
                </p>
                <p className="mt-1 text-xs text-app-text-muted">
                  Branch {link.defaultBranch} · Last synced{' '}
                  {formatRelativeTime(link.lastSyncedAt)}
                </p>
                <a
                  href={link.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-app-accent hover:underline">
                  View on GitHub →
                </a>
              </div>
              <Button
                type="button"
                theme="app"
                className="w-full"
                disabled={isSubmitting}
                onClick={handleExport}>
                {isSubmitting ? 'Pushing…' : 'Push latest changes'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-app-text-secondary">
                Repository name
                <Input
                  value={repoName}
                  onChange={(event) => setRepoName(event.target.value)}
                  theme="app"
                  className="mt-1 h-9 w-full"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-app-text-secondary">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(event) => setIsPrivate(event.target.checked)}
                  className="h-4 w-4 rounded border-app-border"
                />
                Create as a private repository
              </label>
              <Button
                type="button"
                theme="app"
                className="w-full"
                disabled={isSubmitting || !repoName.trim()}
                onClick={handleExport}>
                {isSubmitting ? 'Exporting…' : 'Create repo & push'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

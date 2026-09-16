'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { cn } from '@/lib/utils';

type ActivityEntry =
  | {
      kind: 'build';
      id: string;
      createdAt: string;
      summary: string;
      buildValid: boolean | null;
      fileWrites: Array<{ path: string }>;
      authorName: string | null;
    }
  | {
      kind: 'activity';
      id: string;
      createdAt: string;
      action: string;
      actorEmail: string | null;
    };

type ActivityLogPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
};

const ACTIVITY_LABELS: Record<string, string> = {
  'project.created': 'Project created',
  'project.moved_to_trash': 'Moved to trash',
  'project.restored': 'Restored from trash',
  'project.permanently_deleted': 'Permanently deleted',
  'project.remixed': 'Remixed into a new project',
  'project.github_exported': 'Exported to GitHub',
  'project.github_disconnected': 'GitHub connection removed',
  'project.custom_domain_set': 'Custom domain connected',
  'project.custom_domain_removed': 'Custom domain removed',
  'project.custom_domain_verified': 'Custom domain verified',
};

function describeAction(action: string) {
  return ACTIVITY_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Read-only, near-real-time feed of what's happening on a project: agent
 * build steps (files written, whether the build succeeded) interleaved with
 * lifecycle activity (publish, GitHub export, custom domain, remix, trash).
 * Polls while open. This is our answer to "integrated terminal" for an app
 * builder that produces static file bundles rather than a full dev
 * container — visibility into what changed, without arbitrary shell access.
 */
export function ActivityLogPanel({
  open,
  onClose,
  projectId,
}: ActivityLogPanelProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load(showLoading: boolean) {
      if (showLoading) setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/activity`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setEntries(data.entries ?? []);
      } catch {
        // Best-effort — keep showing the last known entries on failure.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(true);
    const interval = setInterval(() => void load(false), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, projectId]);

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">
              Build &amp; activity log
            </h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Live feed of agent builds and project activity — updates
              automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading && entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Loading…
            </p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Nothing yet &mdash; build steps and activity will appear here as
              they happen.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="rounded-xl border border-app-border-subtle bg-app-surface-active px-3.5 py-2.5">
                  {entry.kind === 'build' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                            entry.buildValid === false
                              ? 'bg-red-500/15 text-red-500'
                              : 'bg-appweaver-orange/15 text-appweaver-orange',
                          )}>
                          {entry.buildValid === false ? 'Build error' : 'Build'}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-sm text-app-text">
                          {entry.summary}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-app-text-muted">
                        {formatRelativeTime(entry.createdAt)}
                        {entry.authorName ? ` · ${entry.authorName}` : ''}
                        {entry.fileWrites.length > 0
                          ? ` · ${entry.fileWrites.length} file${entry.fileWrites.length === 1 ? '' : 's'} changed`
                          : ''}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded-full bg-app-accent-blue/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-app-accent-blue">
                          Activity
                        </span>
                        <p className="min-w-0 flex-1 truncate text-sm text-app-text">
                          {describeAction(entry.action)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-app-text-muted">
                        {formatRelativeTime(entry.createdAt)}
                        {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}

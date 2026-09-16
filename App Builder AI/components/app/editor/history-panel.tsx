'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type Checkpoint = {
  id: string;
  label: string;
  description: string | null;
  isAutomatic: boolean;
  createdAt: string;
  fileCount: number;
  createdByName: string | null;
};

type HistoryPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
};

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

export function HistoryPanel({ open, onClose, projectId }: HistoryPanelProps) {
  const { success, error: toastError } = useToast();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Checkpoint | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/checkpoints`);
        const data = await res.json();
        if (cancelled) return;
        setCheckpoints(data.checkpoints ?? []);
      } catch {
        if (!cancelled) toastError('Could not load version history.');
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

  function handleSaveCheckpoint() {
    const label = newLabel.trim();
    if (!label) return;

    setIsSaving(true);
    void fetch(`/api/projects/${projectId}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          toastError(data.error);
          return;
        }
        setNewLabel('');
        success('Checkpoint saved.');
        return fetch(`/api/projects/${projectId}/checkpoints`)
          .then((res) => res.json())
          .then((refreshed) => setCheckpoints(refreshed.checkpoints ?? []));
      })
      .catch(() => toastError('Could not save checkpoint.'))
      .finally(() => setIsSaving(false));
  }

  function handleConfirmRestore() {
    if (!restoreTarget) return;

    setIsRestoring(true);
    void fetch(
      `/api/projects/${projectId}/checkpoints/${restoreTarget.id}/restore`,
      { method: 'POST' },
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          toastError(data.error);
          setIsRestoring(false);
          return;
        }
        success(`Restored ${data.restoredFiles} file(s).`);
        // Full reload so the file tree, preview, and editor state all
        // reflect the restored files rather than stale client state.
        window.location.reload();
      })
      .catch(() => {
        toastError('Could not restore this checkpoint.');
        setIsRestoring(false);
      });
  }

  return (
    <>
      <AppModalBackdrop
        open={open}
        onClose={onClose}
        panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
            <div>
              <h2 className="font-display text-lg text-app-text">
                Version history
              </h2>
              <p className="mt-0.5 text-xs text-app-text-muted">
                Every agent update is saved automatically. Restore any point,
                or save your own checkpoint.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-app-text-muted transition-colors hover:text-app-text">
              Close
            </button>
          </div>

          <div className="flex gap-2 border-b border-app-border-subtle px-5 py-3">
            <Input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="Name this checkpoint (e.g. Before redesign)"
              theme="app"
              className="h-9 flex-1"
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSaveCheckpoint();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              theme="app"
              disabled={isSaving || !newLabel.trim()}
              onClick={handleSaveCheckpoint}>
              {isSaving ? 'Saving…' : 'Save checkpoint'}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {isLoading ? (
              <p className="py-6 text-center text-sm text-app-text-muted">
                Loading…
              </p>
            ) : checkpoints.length === 0 ? (
              <p className="py-6 text-center text-sm text-app-text-muted">
                No checkpoints yet &mdash; they&apos;ll appear here after the agent
                makes its first change.
              </p>
            ) : (
              <ul className="space-y-2">
                {checkpoints.map((checkpoint) => (
                  <li
                    key={checkpoint.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-app-border-subtle bg-app-surface-active px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-app-text">
                          {checkpoint.label}
                        </p>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                            checkpoint.isAutomatic
                              ? 'bg-app-surface-hover text-app-text-muted'
                              : 'bg-app-accent/15 text-app-accent',
                          )}>
                          {checkpoint.isAutomatic ? 'Auto' : 'Saved'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-app-text-muted">
                        {formatRelativeTime(checkpoint.createdAt)} ·{' '}
                        {checkpoint.fileCount} file
                        {checkpoint.fileCount === 1 ? '' : 's'}
                        {checkpoint.createdByName
                          ? ` · ${checkpoint.createdByName}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      theme="app"
                      className="shrink-0"
                      onClick={() => setRestoreTarget(checkpoint)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </AppModalBackdrop>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleConfirmRestore}
        title="Restore this checkpoint?"
        description="Your current files will be replaced with this checkpoint's version. We'll automatically save your current state first, so you can always undo this."
        itemName={restoreTarget?.label}
        confirmLabel="Restore"
        variant="destructive"
        isPending={isRestoring}
      />
    </>
  );
}

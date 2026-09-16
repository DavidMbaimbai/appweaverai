'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

export function GithubExportSection() {
  const { success, error: toastError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/account/github');
        const data = await res.json();
        if (cancelled) return;
        setConnected(Boolean(data.connected));
        setGithubUsername(data.githubUsername ?? null);
      } catch {
        // Best-effort; leave in disconnected state on failure.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect() {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/account/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      setConnected(true);
      setGithubUsername(data.githubUsername ?? null);
      setToken('');
      success('GitHub connected.');
    } catch {
      toastError('Could not connect GitHub.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await fetch('/api/account/github', { method: 'DELETE' });
      setConnected(false);
      setGithubUsername(null);
      success('GitHub disconnected.');
    } catch {
      toastError('Could not disconnect GitHub.');
    } finally {
      setIsDisconnecting(false);
      setDisconnectOpen(false);
    }
  }

  return (
    <section className="rounded-2xl border border-app-border bg-app-surface px-6 py-5">
      <h2 className="font-display text-lg text-app-text">
        GitHub export
      </h2>
      <p className="mt-1 text-sm text-app-text-muted">
        Connect your GitHub account to export any project as a repository
        and push updates whenever you like.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-app-text-muted">Loading…</p>
      ) : connected ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
          <p className="text-sm text-app-text">
            Connected as{' '}
            <span className="font-medium">{githubUsername}</span>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            theme="app"
            onClick={() => setDisconnectOpen(true)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-app-text-secondary">
            Personal access token
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ghp_..."
              theme="app"
              className="mt-1 h-9 w-full"
            />
          </label>
          <p className="text-xs text-app-text-muted">
            Create a token at{' '}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=AppWeaverAI"
              target="_blank"
              rel="noreferrer"
              className="text-app-accent hover:underline">
              github.com/settings/tokens
            </a>{' '}
            with the <code>repo</code> scope.
          </p>
          <Button
            type="button"
            theme="app"
            size="sm"
            disabled={isSubmitting || !token.trim()}
            onClick={handleConnect}>
            {isSubmitting ? 'Connecting…' : 'Connect GitHub'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={handleDisconnect}
        title="Disconnect GitHub?"
        description="You won't be able to export or sync projects to GitHub until you reconnect."
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={isDisconnecting}
      />
    </section>
  );
}

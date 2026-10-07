'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type PendingCode = {
  userCode: string;
  clientName: string | null;
};

type Status = 'idle' | 'checking' | 'found' | 'not_found' | 'done' | 'denied';

export function CliActivateClient({
  initialUserCode,
}: {
  initialUserCode: string;
}) {
  const { success, error: toastError } = useToast();
  const [code, setCode] = useState(initialUserCode.toUpperCase());
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-check once if a code was supplied via the verification URL.
  useEffect(() => {
    if (initialUserCode.trim()) {
      void lookupCode(initialUserCode);
    }
  }, [initialUserCode]);

  async function lookupCode(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return;

    setStatus('checking');
    try {
      const res = await fetch(
        `/api/cli/device/lookup?userCode=${encodeURIComponent(normalized)}`,
      );
      if (!res.ok) {
        setPending(null);
        setStatus('not_found');
        return;
      }
      const data = await res.json();
      setPending({ userCode: data.userCode, clientName: data.clientName });
      setStatus('found');
    } catch {
      setPending(null);
      setStatus('not_found');
    }
  }

  async function handleApprove() {
    if (!pending) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/cli/device/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: pending.userCode }),
      });
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      setStatus('done');
      success('Device approved. Return to your terminal to continue.');
    } catch {
      toastError('Could not approve this device.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeny() {
    if (!pending) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/cli/device/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: pending.userCode }),
      });
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      setStatus('denied');
    } catch {
      toastError('Could not deny this device.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <h1 className="font-display text-lg text-app-text">
          Activate AppWeaverAI CLI
        </h1>
        <p className="mt-1 text-sm text-app-text-muted">
          Enter the code shown in your terminal to sign in the CLI with this
          account.
        </p>

        {status === 'done' ? (
          <div className="mt-5 rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-4 text-sm text-app-text-secondary">
            ✅ Device approved. You can close this tab and go back to your
            terminal.
          </div>
        ) : status === 'denied' ? (
          <div className="mt-5 rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-4 text-sm text-app-text-secondary">
            This device login request was denied.
          </div>
        ) : (
          <>
            <label className="mt-5 block text-xs font-medium text-app-text-secondary">
              Device code
              <Input
                value={code}
                onChange={(event) => {
                  const next = event.target.value.toUpperCase();
                  setCode(next);
                  setStatus('idle');
                  setPending(null);
                }}
                placeholder="WXYZ-1234"
                theme="app"
                className="mt-1 h-10 w-full text-center font-mono text-base tracking-widest"
              />
            </label>

            {status === 'not_found' && (
              <p className="mt-2 text-xs text-red-400">
                That code wasn&apos;t found or has expired. Check your
                terminal and try again.
              </p>
            )}

            {status === 'found' && pending ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3 text-sm text-app-text-secondary">
                  <p>
                    Sign in to{' '}
                    <span className="font-medium text-app-text">
                      {pending.clientName || 'the AppWeaverAI CLI'}
                    </span>{' '}
                    on this device?
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    theme="app"
                    className="flex-1"
                    disabled={isSubmitting}
                    onClick={handleApprove}>
                    {isSubmitting ? 'Approving…' : 'Approve'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    theme="app"
                    className="flex-1"
                    disabled={isSubmitting}
                    onClick={handleDeny}>
                    Deny
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                theme="app"
                className="mt-4 w-full"
                disabled={!code.trim() || status === 'checking'}
                onClick={() => lookupCode(code)}>
                {status === 'checking' ? 'Checking…' : 'Continue'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

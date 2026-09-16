'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type DomainRecord = {
  domain: string;
  verificationToken: string;
  verifiedAt: string | null;
} | null;

type CustomDomainPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
};

export function CustomDomainPanel({
  open,
  onClose,
  projectId,
}: CustomDomainPanelProps) {
  const { success, error: toastError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [record, setRecord] = useState<DomainRecord>(null);
  const [domainInput, setDomainInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/custom-domain`);
        const data = await res.json();
        if (cancelled) return;
        setRecord(data.domain ?? null);
      } catch {
        if (!cancelled) toastError('Could not load custom domain status.');
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

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainInput }),
      });
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      setRecord(data.domain);
      setDomainInput('');
      success('Domain saved. Add the DNS records below, then verify.');
    } catch {
      toastError('Could not save this domain.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleVerify() {
    setIsVerifying(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/custom-domain/verify`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (data.error) {
        toastError(data.error);
        return;
      }
      if (data.verified) {
        success('Domain verified! It will start serving your project shortly.');
        setRecord((prev) =>
          prev ? { ...prev, verifiedAt: new Date().toISOString() } : prev,
        );
      } else {
        toastError(
          'TXT record not found yet. DNS changes can take a few minutes to propagate.',
        );
      }
    } catch {
      toastError('Could not verify this domain.');
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleRemove() {
    setIsRemoving(true);
    try {
      await fetch(`/api/projects/${projectId}/custom-domain`, {
        method: 'DELETE',
      });
      setRecord(null);
      success('Custom domain removed.');
    } catch {
      toastError('Could not remove this domain.');
    } finally {
      setIsRemoving(false);
      setRemoveOpen(false);
    }
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
                Custom domain
              </h2>
              <p className="mt-0.5 text-xs text-app-text-muted">
                Serve your published project on your own domain.
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
            ) : !record ? (
              <div className="space-y-3">
                <label className="block text-xs font-medium text-app-text-secondary">
                  Domain
                  <Input
                    value={domainInput}
                    onChange={(event) => setDomainInput(event.target.value)}
                    placeholder="app.yourcompany.com"
                    theme="app"
                    className="mt-1 h-9 w-full"
                  />
                </label>
                <Button
                  type="button"
                  theme="app"
                  className="w-full"
                  disabled={isSaving || !domainInput.trim()}
                  onClick={handleSave}>
                  {isSaving ? 'Saving…' : 'Connect domain'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-app-text">
                      {record.domain}
                    </p>
                    <span
                      className={
                        record.verifiedAt
                          ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400'
                          : 'rounded-full bg-app-surface-hover px-2 py-0.5 text-[11px] font-medium text-app-text-muted'
                      }>
                      {record.verifiedAt ? 'Verified' : 'Pending verification'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-app-border-subtle px-4 py-3 text-xs text-app-text-secondary">
                  <p className="font-medium text-app-text">
                    Add these DNS records at your domain provider:
                  </p>
                  <div className="overflow-x-auto rounded-lg bg-app-surface-active p-2 font-mono">
                    <p>Type: CNAME</p>
                    <p>Name: {record.domain.split('.')[0]}</p>
                    <p>Value: appweaverai.com</p>
                  </div>
                  <div className="overflow-x-auto rounded-lg bg-app-surface-active p-2 font-mono">
                    <p>Type: TXT</p>
                    <p>Name: _appweaverai-verify.{record.domain}</p>
                    <p className="break-all">Value: {record.verificationToken}</p>
                  </div>
                </div>

                {!record.verifiedAt ? (
                  <Button
                    type="button"
                    theme="app"
                    className="w-full"
                    disabled={isVerifying}
                    onClick={handleVerify}>
                    {isVerifying ? 'Checking…' : 'Verify domain'}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="secondary"
                  theme="app"
                  className="w-full"
                  disabled={isRemoving}
                  onClick={() => setRemoveOpen(true)}>
                  Disconnect domain
                </Button>
              </div>
            )}
          </div>
        </div>
      </AppModalBackdrop>

      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={handleRemove}
        title="Disconnect this domain?"
        description="Visitors to this domain will no longer see your project."
        itemName={record?.domain}
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={isRemoving}
      />
    </>
  );
}

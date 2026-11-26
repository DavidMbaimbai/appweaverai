'use client';

import { useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

type IdeIntegrationPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  artifactSlug: string | null;
  projectName: string;
  onOpenGithub: () => void;
};

export function IdeIntegrationPanel({
  open,
  onClose,
  projectId,
  artifactSlug,
  projectName,
  onOpenGithub,
}: IdeIntegrationPanelProps) {
  const { success, error: toastError } = useToast();
  const [copied, setCopied] = useState(false);

  const downloadHref = artifactSlug
    ? `/api/projects/${projectId}/artifacts/${artifactSlug}/download`
    : null;

  async function copyCommand() {
    if (!downloadHref) return;

    try {
      await navigator.clipboard.writeText(
        `curl -L "${window.location.origin}${downloadHref}" -o "${projectName}.zip"`,
      );
      setCopied(true);
      success('Download command copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError('Could not copy the download command.');
    }

  }

  function openInVsCode() {
    if (!artifactSlug) {
      toastError('Build the project first to open it in VS Code.');
      return;
    }

    const params = new URLSearchParams({
      projectId,
      artifactSlug,
      appUrl: window.location.origin,
    });
    window.location.href = `vscode://appweaver-ai.appweaver-ai/open?${params.toString()}`;
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg text-app-text">
              Continue in your IDE
            </h2>
            <p className="mt-1 text-sm text-app-text-muted">
              Download the project or keep it synchronized through GitHub.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-app-text-muted hover:text-app-text"
            aria-label="Close IDE integrations">
            ×
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <div className="rounded-xl border border-app-border-subtle bg-app-sidebar-bg p-4">
            <h3 className="text-sm font-medium text-app-text">
              Open in VS Code, IntelliJ, or another IDE
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-app-text-muted">
              Download the ZIP, extract it, and open the extracted folder in
              your preferred IDE. The project keeps its generated source files
              and README instructions.
            </p>
            <Button
              type="button"
              variant="primary"
              theme="app"
              className="mt-3"
              onClick={openInVsCode}
              disabled={!downloadHref}>
              Open in VS Code
            </Button>
            {downloadHref ? (
              <a
                href={downloadHref}
                download
                className="ml-2 mt-3 inline-flex h-9 items-center rounded-lg border border-app-border px-3 text-sm font-medium text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text">
                Download project ZIP
              </a>
            ) : (
              <p className="mt-3 text-xs text-app-text-muted">
                Build the project first to enable downloading.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-app-border-subtle bg-app-sidebar-bg p-4">
            <h3 className="text-sm font-medium text-app-text">
              Command-line download
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-app-text-muted">
              Copy a command for a local terminal, then open the extracted
              folder in VS Code with <code>code .</code> or IntelliJ with its
              project opener.
            </p>
            <Button
              type="button"
              variant="secondary"
              theme="app"
              className="mt-3"
              onClick={copyCommand}
              disabled={!downloadHref}>
              {copied ? 'Copied' : 'Copy download command'}
            </Button>
          </div>

          <div className="rounded-xl border border-app-border-subtle bg-app-sidebar-bg p-4">
            <h3 className="text-sm font-medium text-app-text">
              Keep working with GitHub
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-app-text-muted">
              Push changes from AppWeaver AI, pull local changes back, and use
              branches and pull requests in your normal developer workflow.
            </p>
            <Button
              type="button"
              variant="secondary"
              theme="app"
              className="mt-3"
              onClick={() => {
                onClose();
                onOpenGithub();
              }}>
              Open GitHub sync
            </Button>
          </div>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

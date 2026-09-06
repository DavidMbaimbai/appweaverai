'use client';

import { useEffect, useState } from 'react';

import type { AgentFileWriteSnapshot } from '@/lib/agent/types';
import { normalizeFileContent } from '@/lib/agent/step-utils';
import { cn } from '@/lib/utils';

type AgentFileWriteStreamProps = {
  fileWrites: AgentFileWriteSnapshot[];
  live?: boolean;
  className?: string;
};

const PREVIEW_LINES = 6;

function fileNameFromPath(path: string) {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function statusLabel(status: AgentFileWriteSnapshot['status']) {
  return status === 'streaming' ? 'Writing…' : 'Wrote';
}

function FileWriteCard({
  file,
  live,
}: {
  file: AgentFileWriteSnapshot;
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setMounted(true);
    }, 0);
  }, []);

  const fileName = fileNameFromPath(file.path);
  const content = normalizeFileContent(file.content);
  const lines = content.split('\n');
  const isLong = lines.length > PREVIEW_LINES;
  const previewContent =
    expanded || !isLong
      ? content
      : `${lines.slice(0, PREVIEW_LINES).join('\n')}\n…`;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-app-surface/80',
        file.status === 'streaming'
          ? 'border-replit-orange/30'
          : 'border-app-border-subtle',
      )}>
      <div className="flex items-center gap-2 border-b border-app-border-subtle px-3 py-2">
        {file.status === 'streaming' ? (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-replit-orange/30 border-t-replit-orange" />
          </span>
        ) : (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-replit-orange/15 text-[10px] font-semibold text-replit-orange">
            ✓
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-app-text">{fileName}</p>
          <p className="text-[10px] text-app-text-muted">
            {statusLabel(file.status)} {fileName}
          </p>
        </div>
        <span className="rounded-md bg-app-surface-active px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">
          {file.language}
        </span>
      </div>

      <div className="relative max-h-48 overflow-auto bg-[#0d0d0f] px-3 py-2">
        {mounted ? (
          <pre
            suppressHydrationWarning
            className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-app-text-secondary">
            {previewContent}
            {file.status === 'streaming' && live ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-replit-orange align-middle" />
            ) : null}
          </pre>
        ) : (
          <div className="h-16 animate-pulse rounded bg-app-surface-active/40" />
        )}
      </div>

      {isLong && file.status === 'done' ? (
        <div className="border-t border-app-border-subtle px-3 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[11px] text-app-text-muted transition-colors hover:text-app-text-secondary">
            {expanded ? 'Show less' : 'Show full file'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AgentFileWriteStream({
  fileWrites,
  live = false,
  className,
}: AgentFileWriteStreamProps) {
  if (fileWrites.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {fileWrites.map((file) => (
        <FileWriteCard key={file.path} file={file} live={live} />
      ))}
    </div>
  );
}

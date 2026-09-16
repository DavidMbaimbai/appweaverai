'use client';

import { useEffect, useRef, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { streamTerminalCommand } from '@/lib/code-run/stream-terminal-client';

type TerminalArtifact = { id: string; slug: string; name: string };

type TerminalPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  artifacts: TerminalArtifact[];
  defaultArtifactSlug: string | null;
};

type TerminalLine = {
  id: string;
  kind: 'input' | 'stdout' | 'stderr' | 'system';
  text: string;
};

const QUICK_COMMANDS = [
  'npm install',
  'npm run build',
  'npm test',
  'git status',
  'ls',
];

let lineCounter = 0;
function nextLineId() {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

/**
 * A real, interactive-feeling terminal — but restricted to a fixed
 * allow-list of safe commands (npm install/build/test, git status/log, ls,
 * etc.), each run server-side inside a throwaway, network- and
 * resource-capped Docker container rooted at a scratch copy of the
 * artifact's own files. Typed text is matched verbatim against the
 * allow-list before anything is executed, so there's no shell-injection
 * risk despite the free-text input. Output streams in live as the command
 * runs, closer to a real dev-environment terminal than a static log.
 */
export function TerminalPanel({
  open,
  onClose,
  projectId,
  artifacts,
  defaultArtifactSlug,
}: TerminalPanelProps) {
  const [artifactSlug, setArtifactSlug] = useState(
    defaultArtifactSlug ?? artifacts[0]?.slug ?? '',
  );
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: nextLineId(),
      kind: 'system',
      text: 'Sandboxed terminal — type "help" to see supported commands.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  function appendLine(kind: TerminalLine['kind'], text: string) {
    setLines((current) => [...current, { id: nextLineId(), kind, text }]);
  }

  async function runCommand(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || isRunning || !artifactSlug) return;

    appendLine('input', trimmed);
    setHistory((current) => [...current, trimmed]);
    historyIndexRef.current = null;
    setInput('');

    if (trimmed.toLowerCase() === 'clear') {
      setLines([]);
      return;
    }

    if (trimmed.toLowerCase() === 'help') {
      appendLine(
        'system',
        [
          'Supported commands:',
          ...QUICK_COMMANDS.map((c) => `  ${c}`),
          '  pwd, cat package.json, node -v, npm -v, git log, clear',
        ].join('\n'),
      );
      return;
    }

    setIsRunning(true);
    try {
      await streamTerminalCommand({
        projectId,
        artifactSlug,
        command: trimmed,
        onEvent: (event) => {
          if (event.type === 'output') {
            appendLine(event.stream, event.text);
          } else if (event.type === 'done') {
            appendLine(
              'system',
              event.timedOut
                ? 'Command timed out.'
                : `Process exited with code ${event.exitCode ?? 'unknown'}.`,
            );
          } else if (event.type === 'error') {
            appendLine('system', `Error: ${event.message}`);
          }
        },
      });
    } catch (error) {
      appendLine(
        'system',
        error instanceof Error ? error.message : 'Command failed to run.',
      );
    } finally {
      setIsRunning(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runCommand(input);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      const nextIndex =
        historyIndexRef.current === null
          ? history.length - 1
          : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = nextIndex;
      setInput(history[nextIndex] ?? '');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndexRef.current === null) return;
      const nextIndex = historyIndexRef.current + 1;
      if (nextIndex >= history.length) {
        historyIndexRef.current = null;
        setInput('');
        return;
      }
      historyIndexRef.current = nextIndex;
      setInput(history[nextIndex] ?? '');
    }
  }

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-app-text">Terminal</h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Sandboxed shell — allow-listed commands only, runs in an
              isolated container.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {artifacts.length > 1 ? (
              <Select
                theme="app"
                value={artifactSlug}
                onChange={(event) => setArtifactSlug(event.target.value)}
                aria-label="Artifact"
                className="h-8 w-36 text-xs">
                {artifacts.map((artifact) => (
                  <option key={artifact.id} value={artifact.slug}>
                    {artifact.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-app-text-muted transition-colors hover:text-app-text">
              Close
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-[#0b0b0d] px-4 py-3 font-mono text-xs leading-relaxed">
          {lines.map((line) => (
            <pre
              key={line.id}
              className={cn(
                'whitespace-pre-wrap break-words',
                line.kind === 'input' &&
                  "text-appweaver-orange before:content-['$_']",
                line.kind === 'stdout' && 'text-neutral-200',
                line.kind === 'stderr' && 'text-red-400',
                line.kind === 'system' && 'text-neutral-500',
              )}>
              {line.text}
            </pre>
          ))}
        </div>

        <div className="border-t border-app-border-subtle bg-app-sidebar-bg/40 px-4 py-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                type="button"
                disabled={isRunning || !artifactSlug}
                onClick={() => void runCommand(cmd)}
                className="rounded-md border border-app-border-subtle bg-app-surface px-2 py-1 text-[11px] text-app-text-secondary transition-colors hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
                {cmd}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-app-border-subtle bg-[#0b0b0d] px-3 py-2 font-mono text-xs">
            <span className="text-appweaver-orange">$</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning || !artifactSlug}
              placeholder={
                !artifactSlug
                  ? 'No artifact to run commands against yet'
                  : isRunning
                    ? 'Running…'
                    : 'Type a command (try "help")'
              }
              spellCheck={false}
              autoComplete="off"
              className="flex-1 bg-transparent text-neutral-200 outline-none placeholder:text-neutral-600 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>
    </AppModalBackdrop>
  );
}

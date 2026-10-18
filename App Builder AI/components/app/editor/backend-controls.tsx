'use client';

import { useCallback, useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  detected: { kind: string; label: string } | null;
  state: 'none' | 'starting' | 'running' | 'stopped';
  ready: boolean;
  logs: string;
};

const buttonClass =
  'rounded-md border border-app-border px-2.5 py-1 text-xs text-app-text-secondary transition-colors hover:border-appweaver-orange/50 hover:text-appweaver-orange disabled:cursor-not-allowed disabled:opacity-50';

export function BackendControls({
  projectId,
  artifactSlug,
  hasFiles,
  onError,
}: {
  projectId: string;
  artifactSlug: string;
  hasFiles: boolean;
  onError?: (message: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const endpoint = `/api/projects/${projectId}/backend/${artifactSlug}`;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (response.ok) setStatus((await response.json()) as Status);
    } catch {
      // Status is best-effort; the controls just stay hidden.
    }
  }, [endpoint]);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: Status | null) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endpoint, hasFiles]);

  useEffect(() => {
    if (status?.state !== 'starting') return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [status?.state, refresh]);

  async function call(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method });
      const body = (await response.json()) as Status & { error?: string };
      if (!response.ok) {
        onError?.(body.error ?? 'Backend request failed.');
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runTests() {
    setBusy(true);
    setTestOutput('Running tests… (first run downloads dependencies)');
    try {
      const response = await fetch(`${endpoint}/tests`, { method: 'POST' });
      const body = (await response.json()) as {
        passed?: boolean;
        timedOut?: boolean;
        output?: string;
        error?: string;
      };
      if (!response.ok) {
        setTestOutput(null);
        onError?.(body.error ?? 'Could not run tests.');
        return;
      }
      const verdict = body.timedOut
        ? 'TIMED OUT'
        : body.passed
          ? 'PASSED'
          : 'FAILED';
      setTestOutput(`Tests ${verdict}\n\n${body.output ?? ''}`);
    } catch {
      setTestOutput(null);
      onError?.('Could not run tests.');
    } finally {
      setBusy(false);
    }
  }

  const active = status?.state === 'starting' || status?.state === 'running';

  async function copyProductionEnv() {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/database`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ environment: 'PRODUCTION', reveal: true }),
      });
      const body = (await response.json()) as {
        env?: Record<string, string>;
        error?: string;
      };
      if (!response.ok || !body.env) {
        onError?.(body.error ?? 'Could not create the database.');
        return;
      }
      const text = Object.entries(body.env)
        .map(([key, value]) => `export ${key}='${value}'`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      onError?.('Production database ready. Connection variables copied; paste them in your shell before running the deploy script.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status?.detected && status.enabled ? (
        <>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void runTests()}>
            Run tests
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void copyProductionEnv()}>
            Copy prod DB env
          </button>          <span className="text-xs text-app-text-muted">
            {status.detected.label}:{' '}
            {status.state === 'running'
              ? 'running'
              : status.state === 'starting'
                ? 'starting…'
                : status.state === 'stopped'
                  ? 'stopped'
                  : 'off'}
          </span>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void call('POST')}>
            {active ? 'Restart backend' : 'Run backend'}
          </button>
          {active ? (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void call('DELETE')}>
              Stop
            </button>
          ) : null}
          {status.state !== 'none' ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setShowLogs((value) => !value);
                void refresh();
              }}>
              Logs
            </button>
          ) : null}
        </>
      ) : null}
      {hasFiles ? (
        <a
          className={buttonClass}
          href={`/api/projects/${projectId}/artifacts/${artifactSlug}/download`}
          download>
          Download ZIP
        </a>
      ) : null}
      {testOutput ? (
        <div className="absolute right-4 top-24 z-30 w-[560px] max-w-[90vw] rounded-lg border border-app-border bg-app-bg shadow-lg">
          <div className="flex items-center justify-between border-b border-app-border px-3 py-1.5 text-xs text-app-text-muted">
            Backend tests
            <button type="button" onClick={() => setTestOutput(null)}>
              Close
            </button>
          </div>
          <pre className="max-h-72 overflow-auto p-3 text-[11px] text-app-text-secondary">
            {testOutput}
          </pre>
        </div>
      ) : null}
      {showLogs && status ? (
        <pre className="absolute right-4 top-24 z-20 max-h-64 w-[480px] max-w-[90vw] overflow-auto rounded-lg border border-app-border bg-app-bg p-3 text-[11px] text-app-text-secondary shadow-lg">
          {status.logs || 'No logs yet.'}
        </pre>
      ) : null}
    </div>
  );
}

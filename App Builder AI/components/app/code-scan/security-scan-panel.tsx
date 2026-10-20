'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { acknowledgeFindingAction, requestAiFixAction, runCodeScanAction } from '@/lib/actions/code-scan';
import type { StoredFinding, StoredScan } from '@/lib/code-scan/service';

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-600/20 text-red-300',
  HIGH: 'bg-orange-600/20 text-orange-300',
  MEDIUM: 'bg-yellow-600/20 text-yellow-300',
  LOW: 'bg-sky-600/20 text-sky-300',
  INFO: 'bg-app-surface text-app-text-muted',
};

const BLOCKING = new Set(['CRITICAL', 'HIGH']);

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  isOwner: boolean;
  initialScan: StoredScan | null;
};

export function SecurityScanPanel({ projectId, projectName, builderHref, isOwner, initialScan }: Props) {
  const [scan, setScan] = useState<StoredScan | null>(initialScan);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  function patchFinding(id: string, patch: Partial<StoredFinding>) {
    setScan((current) =>
      current ? { ...current, findings: current.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) } : current,
    );
  }

  function runScan() {
    start(async () => {
      setMessage('');
      const res = await runCodeScanAction(projectId);
      if ('error' in res) setMessage(res.error);
      else setScan(res.scan);
    });
  }

  const blocking = scan?.findings.filter((f) => f.status === 'OPEN' && BLOCKING.has(f.severity)).length ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href={builderHref} className="text-sm text-app-text-secondary hover:underline">
        ← Back to {projectName}
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Security scan</h1>
          <p className="text-sm text-app-text-secondary">
            Checks your project for exposed secrets, risky code, vulnerable dependencies and accessibility issues.
            High and critical findings block publishing until fixed or acknowledged by the owner.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={runScan}
          className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Working…' : scan ? 'Run scan again' : 'Run scan'}
        </button>
      </div>

      {message ? (
        <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
          {message}
        </p>
      ) : null}

      {scan ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Stat label="Critical" value={scan.counts.critical} />
            <Stat label="High" value={scan.counts.high} />
            <Stat label="Medium" value={scan.counts.medium} />
            <Stat label="Low" value={scan.counts.low} />
          </div>
          <p className="mt-3 text-xs text-app-text-muted">
            {scan.filesScanned} files scanned · {new Date(scan.createdAt).toLocaleString()} ·{' '}
            {blocking > 0 ? `${blocking} open blocking finding${blocking === 1 ? '' : 's'}` : 'Publish is not blocked'}
          </p>
          {scan.depStatus === 'UNAVAILABLE' ? (
            <p className="mt-3 rounded-lg border border-yellow-900/60 bg-yellow-950/30 p-3 text-sm text-yellow-300">
              Dependency vulnerability check unavailable: {scan.depDetail ?? 'the vulnerability database could not be reached.'}{' '}
              Your dependencies were not checked, so this is not a clean result.
            </p>
          ) : null}

          {scan.findings.length === 0 ? (
            <p className="mt-6 rounded-lg border border-app-border-subtle p-4 text-sm text-app-text-secondary">
              No findings.
            </p>
          ) : (
            <ul className="mt-6 space-y-3">
              {scan.findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  projectId={projectId}
                  finding={finding}
                  isOwner={isOwner}
                  onChange={(patch) => patchFinding(finding.id, patch)}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-6 rounded-lg border border-app-border-subtle p-4 text-sm text-app-text-secondary">
          No scan has been run yet.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-app-border-subtle p-3">
      <div className="text-xs text-app-text-muted">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function FindingCard({
  projectId,
  finding,
  isOwner,
  onChange,
}: {
  projectId: string;
  finding: StoredFinding;
  isOwner: boolean;
  onChange: (patch: Partial<StoredFinding>) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [ackOpen, setAckOpen] = useState(false);
  const [reason, setReason] = useState('');

  const canAck = isOwner && finding.status === 'OPEN' && BLOCKING.has(finding.severity);

  function requestFix() {
    start(async () => {
      setError('');
      const res = await requestAiFixAction(projectId, finding.id);
      if ('error' in res) setError(res.error);
      else onChange({ fixProposal: res.proposal });
    });
  }

  function acknowledge() {
    start(async () => {
      setError('');
      const res = await acknowledgeFindingAction(projectId, finding.id, reason);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      onChange({ status: 'ACKNOWLEDGED', ackReason: reason.trim(), ackAt: new Date().toISOString() });
      setAckOpen(false);
    });
  }

  return (
    <li className="rounded-xl border border-app-border-subtle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[finding.severity] ?? ''}`}>
          {finding.severity}
        </span>
        <span className="font-medium">{finding.title}</span>
        {finding.status !== 'OPEN' ? (
          <span className="rounded-full bg-app-surface px-2 py-0.5 text-xs text-app-text-muted">
            {finding.status.toLowerCase()}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-app-text-secondary">{finding.message}</p>
      <p className="mt-1 text-xs text-app-text-muted">
        <code>{finding.file}</code>
        {finding.line ? `:${finding.line}` : ''} · <code>{finding.rule}</code>
      </p>
      {finding.snippet ? (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-app-surface p-2 text-xs">{finding.snippet}</pre>
      ) : null}
      {finding.ackReason ? (
        <p className="mt-2 text-xs text-app-text-secondary">Acknowledged: {finding.ackReason}</p>
      ) : null}
      {finding.fixProposal ? (
        <div className="mt-3 rounded-lg border border-app-border-subtle p-3">
          <div className="text-xs font-medium text-app-text-muted">AI suggestion (not applied automatically)</div>
          <pre className="mt-1 whitespace-pre-wrap text-sm">{finding.fixProposal}</pre>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!finding.fixProposal && finding.status === 'OPEN' ? (
          <button
            type="button"
            disabled={pending}
            onClick={requestFix}
            className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Request AI fix'}
          </button>
        ) : null}
        {canAck && !ackOpen ? (
          <button
            type="button"
            onClick={() => setAckOpen(true)}
            className="rounded-full border border-app-border-subtle px-3 py-1 text-xs hover:bg-app-surface-hover"
          >
            Acknowledge risk
          </button>
        ) : null}
      </div>

      {ackOpen ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-app-text-muted" htmlFor={`ack-${finding.id}`}>
            Why is this acceptable? (recorded in the audit log)
          </label>
          <textarea
            id={`ack-${finding.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-lg border border-app-border-subtle bg-transparent p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={acknowledge}
              className="rounded-full bg-app-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Acknowledge
            </button>
            <button type="button" onClick={() => setAckOpen(false)} className="px-3 py-1 text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

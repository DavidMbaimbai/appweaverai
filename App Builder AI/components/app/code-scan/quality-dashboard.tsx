'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';

import {
  decideApprovalAction,
  diagnoseFailureAction,
  requestApprovalAction,
  runRegressionAction,
  setScheduleAction,
} from '@/lib/actions/code-scan';
import type { QualityDashboard } from '@/lib/code-scan/dashboard';
import type { StoredDiagnosis } from '@/lib/code-scan/diagnosis';
import type { StoredRegression } from '@/lib/code-scan/regression';
import type { ScheduleFrequency, StoredSchedule } from '@/lib/code-scan/schedule';
import { SCORE_FORMULA } from '@/lib/code-scan/score';

import { BarList, ScoreGauge, SeverityDonut, TrendLine } from './quality-charts';

type Props = {
  projectId: string;
  projectName: string;
  builderHref: string;
  securityHref: string;
  isOwner: boolean;
  data: QualityDashboard;
};

const REGRESSION_LABEL = { PASSED: 'Passed', FAILED: 'Failed', NOT_RUN: 'Not run' } as const;
const REGRESSION_STYLE = {
  PASSED: 'bg-green-600/20 text-green-300',
  FAILED: 'bg-red-600/20 text-red-300',
  NOT_RUN: 'bg-app-surface text-app-text-muted',
} as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-app-border bg-app-surface/40 p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function QualityDashboardView({ projectId, projectName, builderHref, securityHref, isOwner, data }: Props) {
  const [regression, setRegression] = useState<StoredRegression | null>(data.regression);
  const [schedule, setSchedule] = useState<StoredSchedule | null>(data.schedule);
  const [diagnoses, setDiagnoses] = useState<StoredDiagnosis[]>(data.diagnoses);
  const [approvals, setApprovals] = useState(data.approvals);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [log, setLog] = useState('');
  const [frequency, setFrequency] = useState<ScheduleFrequency>(data.schedule?.frequency ?? 'WEEKLY');
  const [pending, start] = useTransition();

  function runRegression() {
    start(async () => {
      setMessage('');
      const res = await runRegressionAction(projectId);
      if ('error' in res) setMessage(res.error);
      else setRegression(res.regression);
    });
  }

  function saveSchedule(enabled: boolean) {
    start(async () => {
      setMessage('');
      const res = await setScheduleAction(projectId, enabled, frequency);
      if ('error' in res) setMessage(res.error);
      else setSchedule(res.schedule);
    });
  }

  function requestApproval() {
    start(async () => {
      setMessage('');
      const res = await requestApprovalAction(projectId);
      if ('error' in res) setMessage(res.error);
      else {
        setMessage('Approval requested. The project owner can now approve or reject it.');
        setApprovals((current) =>
          current.some((a) => a.id === res.approvalId)
            ? current
            : [
                {
                  id: res.approvalId,
                  status: 'PENDING',
                  risks: data.approvalGate.risks,
                  decisionReason: null,
                  createdAt: new Date().toISOString(),
                  decidedAt: null,
                  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                },
                ...current,
              ],
        );
      }
    });
  }

  function decide(approvalId: string, decision: 'APPROVE' | 'REJECT') {
    start(async () => {
      setMessage('');
      const res = await decideApprovalAction(projectId, approvalId, decision, reason);
      if ('error' in res) setMessage(res.error);
      else {
        setReason('');
        setApprovals((current) =>
          current.map((a) =>
            a.id === approvalId
              ? { ...a, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decisionReason: reason.trim(), decidedAt: new Date().toISOString() }
              : a,
          ),
        );
      }
    });
  }

  function diagnose(source: 'REGRESSION' | 'BUILD' | 'DEPLOY') {
    start(async () => {
      setMessage('');
      const res = await diagnoseFailureAction(projectId, source, log);
      if ('error' in res) setMessage(res.error);
      else setDiagnoses((current) => [res.diagnosis, ...current]);
    });
  }

  const { score, trend, approvalGate } = data;
  const pendingApproval = approvals.find((a) => a.status === 'PENDING');
  const status = [
    { label: 'Security scan', ok: data.scan ? data.severityCounts.CRITICAL + data.severityCounts.HIGH === 0 : null, note: data.scan ? 'No open high/critical findings' : 'Not scanned yet' },
    { label: 'Dependency check', ok: data.scan ? data.scan.depStatus === 'OK' : null, note: data.scan ? `Dependencies: ${data.scan.depStatus.toLowerCase()}` : 'Not scanned yet' },
    { label: 'Regression check', ok: regression?.status === 'PASSED' ? true : regression?.status === 'FAILED' ? false : null, note: regression ? REGRESSION_LABEL[regression.status] : 'Not run' },
    { label: 'Owner approval', ok: approvalGate.required ? approvalGate.state === 'APPROVED' : true, note: approvalGate.required ? 'Needed for risky production changes' : 'No risky changes pending' },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href={builderHref} className="text-sm text-app-text-secondary hover:underline">
        ← Back to {projectName}
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Quality &amp; Security</h1>
          <p className="text-sm text-app-text-secondary">Score, trends, regression checks and approvals before you publish.</p>
        </div>
        <Link href={securityHref} className="rounded-full border border-app-border px-4 py-2 text-sm">
          Open security scan
        </Link>
      </div>

      {message ? (
        <p role="status" className="mt-4 rounded-lg border border-app-border bg-app-surface p-3 text-sm">
          {message}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card title="Quality score">
          {score ? (
            <>
              <div className="flex justify-center">
                <ScoreGauge score={score.score} grade={score.grade} />
              </div>
              <p className="mt-2 text-xs text-app-text-secondary">
                {trend.direction === 'none' ? 'First scan' : `${trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '■'} ${trend.delta > 0 ? '+' : ''}${trend.delta} vs previous scan`}
              </p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">How is this calculated?</summary>
                <p className="mt-1 text-app-text-secondary">{SCORE_FORMULA}</p>
                <table className="mt-2 w-full">
                  <tbody>
                    {score.breakdown
                      .filter((row) => row.severity !== 'INFO')
                      .map((row) => (
                        <tr key={row.severity}>
                          <td className="capitalize">{row.severity.toLowerCase()}</td>
                          <td>{row.open} open</td>
                          <td>{row.acknowledged} ack.</td>
                          <td className="text-right">−{row.penalty}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="text-sm text-app-text-secondary">No scan yet. Run a security scan to get a score.</p>
          )}
        </Card>

        <Card title="Open findings by severity">
          <SeverityDonut counts={data.severityCounts} />
        </Card>

        <Card title="Status">
          <ul className="space-y-2 text-sm">
            {status.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-2">
                <span>{item.label}</span>
                <span className={item.ok === null ? 'text-app-text-muted' : item.ok ? 'text-green-300' : 'text-red-300'}>
                  {item.ok === null ? '—' : item.ok ? '✓' : '✗'} {item.note}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card title="Open findings by age">
          <BarList rows={data.ageBuckets.map((b) => ({ label: b.label, value: b.count }))} emptyText="No open findings." />
        </Card>
        <Card title="Most affected files">
          <BarList
            rows={data.topFiles.map((f) => ({ label: f.file, value: f.weight, hint: `${f.count} open` }))}
            emptyText="No open findings."
          />
        </Card>
        <Card title="Scan history">
          <TrendLine points={data.history} />
          <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-xs text-app-text-secondary">
            {[...data.history].reverse().map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString()} · score {h.score} · {h.critical}C/{h.high}H/{h.medium}M/{h.low}L
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Regression check (tests / build)">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${REGRESSION_STYLE[regression?.status ?? 'NOT_RUN']}`}>
              {REGRESSION_LABEL[regression?.status ?? 'NOT_RUN']}
            </span>
            {regression ? <span className="text-xs text-app-text-secondary">{new Date(regression.createdAt).toLocaleString()}</span> : null}
            <button type="button" disabled={pending} onClick={runRegression} className="ml-auto rounded-full bg-app-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {pending ? 'Working…' : 'Run check'}
            </button>
          </div>
          <p className="mt-2 text-xs text-app-text-secondary">
            Runs your project&apos;s own tests (or build) in an isolated sandbox. If it cannot run, it shows “Not run”, never a pass.
          </p>
          {regression?.output ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap">{regression.output}</pre>
          ) : null}
          {regression?.status === 'FAILED' ? (
            <button type="button" disabled={pending} onClick={() => diagnose('REGRESSION')} className="mt-2 rounded-full border border-app-border px-3 py-1.5 text-xs disabled:opacity-50">
              Diagnose with AI
            </button>
          ) : null}
        </Card>

        <Card title="Scheduled re-scan">
          {data.canSchedule ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)} className="rounded border border-app-border bg-app-surface px-2 py-1 text-sm">
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                </select>
                <button type="button" disabled={pending} onClick={() => saveSchedule(true)} className="rounded-full bg-app-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  {schedule?.enabled ? 'Update' : 'Enable'}
                </button>
                {schedule?.enabled ? (
                  <button type="button" disabled={pending} onClick={() => saveSchedule(false)} className="rounded-full border border-app-border px-3 py-1.5 text-xs disabled:opacity-50">
                    Turn off
                  </button>
                ) : null}
              </div>
              {schedule ? (
                <p className="text-xs text-app-text-secondary">
                  {schedule.enabled ? `Next run ${new Date(schedule.nextRunAt).toLocaleString()}` : 'Off'}
                  {schedule.lastRunAt ? ` · last run ${new Date(schedule.lastRunAt).toLocaleString()}` : ''}
                  {schedule.lastError ? ` · ${schedule.lastError}` : ''}
                </p>
              ) : null}
              <p className="text-xs text-app-text-secondary">Scheduled scans are free of credits.</p>
            </div>
          ) : (
            <p className="text-sm text-app-text-secondary">Scheduled re-scans are part of the Pro plan. You can still scan on demand.</p>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Approval for risky production changes">
          {approvalGate.required ? (
            <>
              <p className="text-sm">The next production publish needs explicit owner approval because:</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {approvalGate.risks.map((r) => (
                  <li key={r.kind}>{r.summary}</li>
                ))}
              </ul>
              {!pendingApproval && approvalGate.state !== 'APPROVED' ? (
                <button type="button" disabled={pending} onClick={requestApproval} className="mt-3 rounded-full bg-app-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  Request approval
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-app-text-secondary">No risky changes are pending. Publishing needs no extra approval.</p>
          )}
          {pendingApproval && isOwner ? (
            <div className="mt-3 space-y-2">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Reason (required, at least 10 characters)" className="w-full rounded border border-app-border bg-app-surface p-2 text-sm" />
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => decide(pendingApproval.id, 'APPROVE')} className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  Approve
                </button>
                <button type="button" disabled={pending} onClick={() => decide(pendingApproval.id, 'REJECT')} className="rounded-full border border-app-border px-3 py-1.5 text-xs disabled:opacity-50">
                  Reject
                </button>
              </div>
            </div>
          ) : pendingApproval ? (
            <p className="mt-3 text-xs text-app-text-secondary">Waiting for the project owner to decide.</p>
          ) : null}
          {approvals.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-app-text-secondary">
              {approvals.slice(0, 5).map((a) => (
                <li key={a.id}>
                  {new Date(a.createdAt).toLocaleString()} · {a.status.toLowerCase()}
                  {a.decisionReason ? ` · “${a.decisionReason}”` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Diagnose a failed build or deploy">
          <p className="text-xs text-app-text-secondary">
            Paste the error output. Secrets are removed before it is sent, the AI only suggests a fix (never applies it) and each diagnosis uses credits.
          </p>
          <textarea value={log} onChange={(e) => setLog(e.target.value)} rows={4} maxLength={20000} placeholder="Paste build or deploy error output…" className="mt-2 w-full rounded border border-app-border bg-app-surface p-2 font-mono text-xs" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending || log.trim().length < 20} onClick={() => diagnose('BUILD')} className="rounded-full bg-app-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Diagnose build error
            </button>
            <button type="button" disabled={pending || log.trim().length < 20} onClick={() => diagnose('DEPLOY')} className="rounded-full border border-app-border px-3 py-1.5 text-xs disabled:opacity-50">
              Diagnose deploy error
            </button>
          </div>
          {diagnoses.map((d) => (
            <div key={d.id} className="mt-3 rounded border border-app-border p-3">
              <p className="text-xs text-app-text-secondary">
                {d.source.toLowerCase()} · {new Date(d.createdAt).toLocaleString()} · suggestion only
              </p>
              <pre className="mt-1 whitespace-pre-wrap text-sm">{d.diagnosis}</pre>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

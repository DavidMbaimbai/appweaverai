'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import {
  approveDevTeamRunAction,
  cancelDevTeamRunAction,
  rejectDevTeamRunAction,
  resolveDevTeamConflictAction,
  startDevTeamRunAction,
} from '@/lib/actions/dev-team';
import { DEV_TEAM_ROLE_LABELS, isDevTeamRole } from '@/lib/dev-team/types';
import type { TeamFileView, TeamPageData } from '@/lib/dev-team/view';

const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';
const card = 'space-y-2 rounded-xl border border-app-border-subtle p-4';
const ACTIVE = ['PLANNING', 'RUNNING'];

const roleLabel = (role: string | null) => (role && isDevTeamRole(role) ? DEV_TEAM_ROLE_LABELS[role].label : 'System');

function Diff({ file }: { file: TeamFileView }) {
  if (file.rows.length === 0) return <p className="text-xs text-app-text-muted">No line changes to show.</p>;
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-app-border-subtle p-2 text-xs">
      {file.rows.map((row, i) => (
        <div key={i} className={row.type === 'add' ? 'text-green-600' : row.type === 'del' ? 'text-red-500' : 'text-app-text-muted'}>
          {row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : row.type === 'gap' ? '' : '  '}
          {row.type === 'gap' ? '…' : row.text}
        </div>
      ))}
      {file.truncated ? <div className="text-app-text-muted">… diff truncated</div> : null}
    </pre>
  );
}

function ConflictControls({ projectId, runId, file, onDone }: { projectId: string; runId: string; file: TeamFileView; onDone: (msg: string) => void }) {
  const [pending, start] = useTransition();
  const [manual, setManual] = useState('');
  const act = (choice: Parameters<typeof resolveDevTeamConflictAction>[3]) =>
    start(async () => {
      const result = await resolveDevTeamConflictAction(projectId, runId, file.path, choice);
      onDone(result.ok ? '' : result.error);
    });
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 p-3 text-sm">
      <p className="text-app-text">{file.conflictReason ?? 'Conflicting changes. Nothing is applied until you decide.'}</p>
      <div className="flex flex-wrap gap-2">
        {file.proposals.map((p) => (
          <button key={p.id} className={btn} disabled={pending} title={p.rationale} onClick={() => act({ kind: 'PROPOSAL', proposalId: p.id })}>
            Use {roleLabel(p.role)} version
          </button>
        ))}
        {file.hasSuggestion ? (
          <button className={btn} disabled={pending} onClick={() => act({ kind: 'SUGGESTION' })}>Accept Architect suggestion</button>
        ) : null}
        <button className={btn} disabled={pending} onClick={() => act({ kind: 'DROP' })}>Drop changes to this file</button>
      </div>
      <textarea
        className="h-24 w-full rounded-lg border border-app-border bg-transparent p-2 font-mono text-xs text-app-text"
        placeholder="Or paste the final file content"
        value={manual}
        onChange={(e) => setManual(e.target.value)}
      />
      <button className={btn} disabled={pending || manual.length === 0} onClick={() => act({ kind: 'MANUAL', content: manual })}>Use pasted content</button>
    </div>
  );
}

export function DevTeamPanel({ projectId, projectName, isOwner, data }: { projectId: string; projectName: string; isOwner: boolean; data: TeamPageData }) {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [reason, setReason] = useState('');
  const [ackNotRun, setAckNotRun] = useState(false);
  const [ackProtected, setAckProtected] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const run = data.run;
  const active = run ? ACTIVE.includes(run.status) : false;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, router]);

  const report = (result: { ok: true; message?: string } | { ok: false; error: string }) => {
    setMessage(result.ok ? (result.message ?? '') : result.error);
    router.refresh();
  };
  const v = run?.verification ?? null;
  const awaiting = run?.status === 'AWAITING_APPROVAL';

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-app-text">AI development team — {projectName}</h1>
        <p className="text-sm text-app-text-secondary">
          Specialised roles plan and propose changes together. Nothing is changed in your project until you review and approve it.
        </p>
      </header>

      {data.paused ? <p className="rounded-lg border border-red-500/40 p-3 text-sm text-red-500">AI agents are paused by the kill switch. New runs are blocked and nothing can be applied.</p> : null}

      <section className={card}>
        <h2 className="font-medium text-app-text">New run</h2>
        <textarea
          className="h-24 w-full rounded-lg border border-app-border bg-transparent p-2 text-sm text-app-text"
          placeholder="Describe what the team should build or change"
          value={goal}
          maxLength={2000}
          onChange={(e) => setGoal(e.target.value)}
        />
        <p className="text-xs text-app-text-muted">
          {data.estimate.blocked ? data.estimate.blocked.message : `Estimated up to ${data.estimate.maxCredits} credits (hard cap per run). `}
          {data.disclaimer}
        </p>
        <button
          className={btn}
          disabled={pending || active || data.paused || goal.trim().length < 10 || Boolean(data.estimate.blocked)}
          onClick={() =>
            start(async () => {
              const result = await startDevTeamRunAction(projectId, goal);
              if (result.ok) setGoal('');
              report(result);
            })
          }
        >
          Start run
        </button>
      </section>

      {message ? <p className="text-sm text-app-text-secondary" role="status">{message}</p> : null}

      {run ? (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium text-app-text">Current run</h2>
              <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-app-text-muted">{run.status}</span>
              <span className="text-xs text-app-text-muted">{run.spentCredits}/{run.reservedCredits} credits used</span>
              {active ? <button className={btn} disabled={pending} onClick={() => start(async () => report(await cancelDevTeamRunAction(projectId, run.id)))}>Cancel</button> : null}
            </div>
            <p className="text-sm text-app-text-secondary">{run.goal}</p>
            {run.planSummary ? <p className="text-xs text-app-text-muted">Plan: {run.planSummary}</p> : null}
            {run.error ? <p className="text-xs text-red-500">{run.error}</p> : null}
          </section>

          <section className={card}>
            <h2 className="font-medium text-app-text">Task graph</h2>
            <ul className="space-y-1 text-sm">
              {run.tasks.map((t) => (
                <li key={t.key} className="rounded-lg border border-app-border-subtle p-2">
                  <span className="font-mono text-xs text-app-text-muted">{t.key}</span>{' '}
                  <strong className="text-app-text">{t.title}</strong>{' '}
                  <span className="text-app-text-muted">· {roleLabel(t.role)} · {t.status}{t.dependsOn.length ? ` · after ${t.dependsOn.join(', ')}` : ''}</span>
                  {t.summary ? <p className="text-xs text-app-text-secondary">{t.summary}</p> : null}
                  {t.error ? <p className="text-xs text-red-500">{t.error}</p> : null}
                </li>
              ))}
              {run.tasks.length === 0 ? <li className="text-app-text-muted">The Architect is planning…</li> : null}
            </ul>
          </section>

          <section className={card}>
            <h2 className="font-medium text-app-text">Team messages</h2>
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">
              {run.messages.map((m) => (
                <li key={m.id} className="text-app-text-secondary">
                  <strong className="text-app-text">{roleLabel(m.role)}</strong> <span className="text-xs text-app-text-muted">[{m.kind}]</span> {m.content}
                </li>
              ))}
            </ul>
          </section>

          <section className={card}>
            <h2 className="font-medium text-app-text">Proposed changes</h2>
            {run.files.length === 0 ? <p className="text-sm text-app-text-muted">No file changes were proposed.</p> : null}
            {run.files.map((file) => (
              <div key={file.id} className="space-y-2">
                <p className="text-sm text-app-text">
                  <span className="font-mono">{file.path}</span> <span className="text-app-text-muted">· {file.op} · {file.status}</span>
                </p>
                {file.status === 'CONFLICT' && run.status === 'NEEDS_DECISION' ? (
                  <ConflictControls projectId={projectId} runId={run.id} file={file} onDone={(m) => { setMessage(m); router.refresh(); }} />
                ) : file.status === 'STALE' ? (
                  <p className="text-xs text-amber-600">{file.conflictReason ?? 'This file changed after the team read it.'} Reject this run and start a new one.</p>
                ) : null}
                <Diff file={file} />
              </div>
            ))}
          </section>

          {v ? (
            <section className={card}>
              <h2 className="font-medium text-app-text">Verification</h2>
              <p className="text-sm text-app-text-secondary">
                Security scan: {v.scan.status === 'NOT_RUN' ? `not run — ${v.scan.reason}` : `${v.scan.status} (${v.scan.newFindings.length} new finding(s))`}
              </p>
              <p className="text-sm text-app-text-secondary">Tests/build: not run — {v.regression.reason}</p>
              {v.scan.status !== 'NOT_RUN' && v.scan.newFindings.length > 0 ? (
                <ul className="text-xs text-app-text-muted">
                  {v.scan.newFindings.map((f, i) => <li key={i}>{f.severity} · {f.file}{f.line ? `:${f.line}` : ''} · {f.title}</li>)}
                </ul>
              ) : null}
              {v.blockers.map((b, i) => <p key={`b${i}`} className="text-xs text-red-500">Blocked: {b}</p>)}
              {v.warnings.map((w, i) => <p key={`w${i}`} className="text-xs text-amber-600">{w}</p>)}
            </section>
          ) : null}

          {(awaiting || run.status === 'NEEDS_DECISION') ? (
            <section className={card}>
              <h2 className="font-medium text-app-text">Decision</h2>
              {!isOwner ? <p className="text-xs text-app-text-muted">Only the project owner can approve or reject.</p> : null}
              <textarea
                className="h-16 w-full rounded-lg border border-app-border bg-transparent p-2 text-sm text-app-text"
                placeholder="Reason for your decision (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {awaiting ? (
                <>
                  <label className="flex items-center gap-2 text-sm text-app-text-secondary">
                    <input type="checkbox" checked={ackNotRun} onChange={(e) => setAckNotRun(e.target.checked)} /> I understand tests and build were not run on these changes.
                  </label>
                  {v && v.protectedTouched.length > 0 ? (
                    <label className="flex items-center gap-2 text-sm text-app-text-secondary">
                      <input type="checkbox" checked={ackProtected} onChange={(e) => setAckProtected(e.target.checked)} /> I reviewed the protected features these changes touch.
                    </label>
                  ) : null}
                </>
              ) : null}
              <div className="flex gap-2">
                {awaiting ? (
                  <button
                    className={btn}
                    disabled={pending || !isOwner || data.paused || !v?.canApprove}
                    onClick={() => start(async () => report(await approveDevTeamRunAction(projectId, run.id, { reason, acknowledgeNotRun: ackNotRun, acknowledgeProtected: ackProtected })))}
                  >
                    Approve and apply
                  </button>
                ) : null}
                <button className={btn} disabled={pending || !isOwner} onClick={() => start(async () => report(await rejectDevTeamRunAction(projectId, run.id, reason)))}>
                  Reject
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {data.history.length > 1 ? (
        <section className={card}>
          <h2 className="font-medium text-app-text">Earlier runs</h2>
          <ul className="text-sm text-app-text-secondary">
            {data.history.slice(1).map((h) => <li key={h.id}>{new Date(h.createdAt).toLocaleString()} · {h.status} · {h.goal.slice(0, 100)}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

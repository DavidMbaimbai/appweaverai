'use client';

import { useState, useTransition } from 'react';

import {
  approveLaunchAction,
  generateLegalDraftAction,
  runLaunchReadinessAction,
} from '@/lib/actions/launch';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { StoredReport } from '@/lib/launch-readiness/service';

const BADGE: Record<string, string> = {
  PASS: 'bg-emerald-500/15 text-emerald-400',
  WARN: 'bg-amber-500/15 text-amber-400',
  FAIL: 'bg-red-500/15 text-red-400',
  NOT_VERIFIED: 'bg-app-surface-hover text-app-text-muted',
};

const LEGAL_NOTICE =
  'AI-generated drafts are a starting point only and are not legal advice. Have a qualified professional review them before relying on them.';

export function LaunchChecklist({
  projectId,
  initialReport,
}: {
  projectId: string;
  initialReport: StoredReport | null;
}) {
  const { success, error: toastError } = useToast();
  const [report, setReport] = useState<StoredReport | null>(initialReport);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await runLaunchReadinessAction(projectId, 'PRODUCTION');
      if ('error' in result) {
        toastError(result.error);
        return;
      }
      setReport(result.report);
      setAcknowledged(false);
    });
  }

  function approve() {
    if (!report) return;
    startTransition(async () => {
      const result = await approveLaunchAction(projectId, report.id, acknowledged);
      if ('error' in result) {
        toastError(result.error);
        return;
      }
      setReport({ ...report, approvedAt: new Date().toISOString(), acknowledgedWarnings: acknowledged });
      success('Launch approved.');
    });
  }

  function draft(kind: 'privacy' | 'terms') {
    startTransition(async () => {
      const result = await generateLegalDraftAction(projectId, kind);
      if ('error' in result) toastError(result.error);
      else success(`Draft saved as ${result.path}. Edit it in your project files.`);
    });
  }

  const hasFail = (report?.failCount ?? 0) > 0;
  const hasWarn = (report?.warnCount ?? 0) > 0;
  const canApprove = Boolean(report) && !hasFail && (!hasWarn || acknowledged) && !report?.approvedAt;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-app-text-secondary">
          Automated checks of your site. They report only what was inspected; anything not
          checked is marked Not verified.
        </p>
        <Button type="button" theme="app" disabled={isPending} onClick={run}>
          {isPending ? 'Working…' : report ? 'Re-run checks' : 'Run checks'}
        </Button>
      </div>

      {report ? (
        <>
          <div className="rounded-xl border border-app-border-subtle px-4 py-3 text-sm text-app-text">
            <p>{report.verdict}</p>
            <p className="mt-1 text-xs text-app-text-muted">
              Checked {new Date(report.createdAt).toLocaleString()} · {report.failCount} failing ·{' '}
              {report.warnCount} warning(s)
              {report.approvedAt
                ? ` · approved ${new Date(report.approvedAt).toLocaleString()}${
                    report.acknowledgedWarnings ? ' with warnings acknowledged' : ''
                  }`
                : ''}
            </p>
          </div>

          <ul className="space-y-2">
            {report.results.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-app-text">{item.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[item.status]}`}>
                    {item.status === 'NOT_VERIFIED' ? 'Not verified' : item.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-app-text-secondary">{item.evidence}</p>
                {item.advice ? <p className="mt-1 text-xs text-app-text-muted">{item.advice}</p> : null}
              </li>
            ))}
          </ul>

          <div className="space-y-3 rounded-xl border border-app-border-subtle px-4 py-3">
            {hasWarn && !hasFail ? (
              <label className="flex items-start gap-2 text-xs text-app-text-secondary">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5"
                />
                I have reviewed the warnings and want to launch anyway.
              </label>
            ) : null}
            {hasFail ? (
              <p className="text-xs text-red-400">
                Failing checks must be fixed before you can approve the launch.
              </p>
            ) : null}
            <Button type="button" theme="app" disabled={isPending || !canApprove} onClick={approve}>
              Approve launch
            </Button>
            <p className="text-xs text-app-text-muted">
              Approval records your decision. It does not guarantee the site is free of problems.
            </p>
          </div>
        </>
      ) : (
        <p className="py-6 text-center text-sm text-app-text-muted">No report yet.</p>
      )}

      <div className="space-y-2 rounded-xl border border-app-border-subtle px-4 py-3">
        <p className="text-sm font-medium text-app-text">Privacy policy and terms drafts</p>
        <p className="text-xs text-amber-400">{LEGAL_NOTICE}</p>
        <div className="flex gap-2">
          <Button type="button" theme="app" variant="secondary" disabled={isPending} onClick={() => draft('privacy')}>
            Draft privacy page
          </Button>
          <Button type="button" theme="app" variant="secondary" disabled={isPending} onClick={() => draft('terms')}>
            Draft terms page
          </Button>
        </div>
        <p className="text-xs text-app-text-muted">
          Saved as privacy.html and terms.html in your project so you can edit them. Existing files
          are never overwritten.
        </p>
      </div>
    </div>
  );
}

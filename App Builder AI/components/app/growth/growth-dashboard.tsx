'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  approveExperimentAction,
  measureExperimentAction,
  proposeExperimentsAction,
  rejectExperimentAction,
  startExperimentAction,
} from '@/lib/actions/project-growth';
import type { ProposedAction } from '@/lib/growth/experiments';
import type { GrowthSnapshot } from '@/lib/growth/metrics';

type ExperimentView = {
  id: string;
  hypothesis: string;
  bottleneck: string;
  action: ProposedAction;
  estimatedCostCents: number | null;
  status: string;
  before: { value: number | null } | null;
  after: { value: number | null } | null;
  resultNote: string | null;
  windowDays: number;
  startedAt: string | null;
  execution: Record<string, string> | null;
};
type Res = { ok: boolean; error?: string; message?: string };

const card = 'rounded-2xl border border-app-border bg-app-surface p-6';
const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';

const format = (value: number | null, unit: string) => (value == null ? null : unit === 'percent' ? `${value}%` : unit === 'rating' ? `${value} / 5` : value.toLocaleString());

function ExperimentCard({ e }: { e: ExperimentView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? (res.message ?? '') : (res.error ?? 'Something went wrong.'));
      router.refresh();
    });

  return (
    <li className="space-y-2 rounded-xl border border-app-border-subtle p-4 text-sm text-app-text">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{e.action.title}</strong>
        <span className="text-xs text-app-text-muted">
          {e.status} · priority {e.action.priority} · {e.action.type.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>
      <p><span className="text-app-text-muted">Bottleneck:</span> {e.bottleneck}</p>
      <p><span className="text-app-text-muted">Hypothesis to test:</span> {e.hypothesis}</p>
      <p className="text-xs text-app-text-muted">
        Based on: {e.action.citedMetrics.map((c) => `${c.key} = ${c.value}`).join(', ')} · compares {e.action.metricKey} over {e.windowDays} days before and after
        {e.estimatedCostCents != null ? ` · estimated cost ${(e.estimatedCostCents / 100).toFixed(2)} (informational; nothing is ever charged automatically)` : ''}
      </p>
      <p className="whitespace-pre-wrap text-xs">{e.action.brief}</p>
      {e.execution?.kind === 'landing-prompt' ? (
        <div className="space-y-1">
          <pre className="whitespace-pre-wrap rounded-lg bg-app-border-subtle p-2 text-xs">{e.execution.prompt}</pre>
          <button className={btn} onClick={() => void navigator.clipboard.writeText(e.execution!.prompt)}>Copy builder prompt</button>{' '}
          <a className={btn} href={e.execution.builderHref}>Open builder</a>
        </div>
      ) : null}
      {e.execution?.kind === 'campaign-draft' ? <p className="text-xs">Campaign draft created (unpublished). Find it in Marketing.</p> : null}
      {e.execution?.kind === 'dev-ticket' ? <p className="text-xs">Ticket created in Reviews &amp; support → Issues.</p> : null}
      {e.before ? (
        <p className="text-xs">
          Before: {e.before.value ?? 'not available'}
          {e.status === 'MEASURED' ? ` · After: ${e.after?.value ?? 'not available'}` : ''}
        </p>
      ) : null}
      {e.resultNote ? <p className="text-xs text-app-text-muted">{e.resultNote}</p> : null}
      <div className="flex flex-wrap gap-2">
        {e.status === 'PROPOSED' ? (
          <>
            <button className={btn} disabled={pending} onClick={() => run(() => approveExperimentAction(e.id))}>Approve</button>
            <button className={btn} disabled={pending} onClick={() => run(() => rejectExperimentAction(e.id))}>Reject</button>
          </>
        ) : null}
        {e.status === 'APPROVED' ? (
          <>
            <button className={btn} disabled={pending} onClick={() => run(() => startExperimentAction(e.id))}>Start (safe action only)</button>
            <button className={btn} disabled={pending} onClick={() => run(() => rejectExperimentAction(e.id))}>Reject</button>
          </>
        ) : null}
        {e.status === 'RUNNING' ? (
          <button className={btn} disabled={pending} onClick={() => run(() => measureExperimentAction(e.id))}>Measure results</button>
        ) : null}
      </div>
      {message ? <p className="text-xs text-app-text-muted">{message}</p> : null}
    </li>
  );
}

export function GrowthDashboard({
  projectId,
  projectName,
  leadsHref,
  days,
  caveat,
  snapshot,
  experiments,
}: {
  projectId: string;
  projectName: string;
  leadsHref: string;
  days: number;
  caveat: string;
  snapshot: GrowthSnapshot;
  experiments: ExperimentView[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl text-app-text">Growth — {projectName}</h1>
        <p className="mt-1 text-sm text-app-text-muted">{caveat}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {[7, 30, 90].map((d) => (
            <a key={d} className={btn + (d === days ? ' bg-app-border-subtle' : '')} href={`?days=${d}`}>Last {d} days</a>
          ))}
          <a className={btn} href={leadsHref}>Leads CRM</a>
        </div>
      </header>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Metrics</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.metrics.map((m) => (
            <div key={m.key} className="rounded-xl border border-app-border-subtle p-3">
              <div className="text-xs text-app-text-muted">{m.label}</div>
              <div className="text-2xl text-app-text">{format(m.value, m.unit) ?? 'Not available'}</div>
              <div className="text-xs text-app-text-muted">
                {m.status === 'measured' ? 'measured' : 'not available'} · {m.source}
              </div>
              {m.note ? <div className="mt-1 text-xs text-app-text-muted">{m.note}</div> : null}
            </div>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-3 font-display text-lg text-app-text">Leads by source (measured)</h2>
        {snapshot.leadsBySource.length ? (
          <div className="grid gap-4 sm:grid-cols-2 text-sm text-app-text">
            <ul>
              {snapshot.leadsBySource.map((b) => (
                <li key={b.label}>{b.label}: {b.count}</li>
              ))}
            </ul>
            <ul>
              {snapshot.leadsByUtm.map((b) => (
                <li key={b.label}>UTM {b.label}: {b.count}</li>
              ))}
              <li className="text-xs text-app-text-muted">
                Without UTM tags: {snapshot.leadsWithoutUtm ?? 'not available'}
              </li>
            </ul>
          </div>
        ) : (
          <p className="text-sm text-app-text-muted">Not available — no leads in this period.</p>
        )}
      </section>

      <section className={card}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto font-display text-lg text-app-text">Growth agent experiments</h2>
          <button
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await proposeExperimentsAction(projectId);
                setMessage(res.ok ? (res.message ?? '') : res.error);
                router.refresh();
              })
            }
          >
            {pending ? 'Analysing…' : 'Suggest experiments'}
          </button>
        </div>
        <p className="mb-3 text-xs text-app-text-muted">
          The agent only cites the numbers above and promises no results. Approving an experiment never spends money or publishes anything: it can only create a
          draft campaign, a ticket, or a builder prompt for you to review.
        </p>
        {message ? <p className="mb-2 text-sm text-app-text-muted">{message}</p> : null}
        <ul className="space-y-3">
          {experiments.map((e) => (
            <ExperimentCard key={e.id} e={e} />
          ))}
          {!experiments.length ? <li className="text-sm text-app-text-muted">No experiments yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';

import { formatMetricValue, type EvidenceRow } from '@/lib/growth-bi/recommend';

export type RecommendationView = {
  id: string;
  title: string;
  rationale: string;
  status: string;
  action: { type: string; brief: string };
  evidence: EvidenceRow[];
};

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Shared by the admin and project pages; the server actions are injected so each applies its own authorisation. */
export function RecommendationsPanel({
  items,
  generate,
  decide,
  note,
}: {
  items: RecommendationView[];
  generate: () => Promise<Result>;
  decide: (id: string, decision: 'approve' | 'reject') => Promise<Result>;
  note: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ?? 'Done.') : r.error);
    });
  return (
    <div className="space-y-3">
      <p className="text-xs text-app-text-muted">{note}</p>
      <button type="button" disabled={pending} onClick={() => run(generate)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
        {pending ? 'Working…' : 'Generate recommendations'}
      </button>
      {msg ? <p role="status" className="text-xs text-app-text-secondary">{msg}</p> : null}
      {items.map((r) => (
        <article key={r.id} className="rounded-lg border border-app-border-subtle p-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-medium text-app-text">{r.title}</h3>
            <span className="rounded-full bg-app-border-subtle px-2 py-0.5 text-[10px] uppercase text-app-text-secondary">{r.status}</span>
          </div>
          <p className="mt-1 text-xs text-app-text-secondary">{r.rationale}</p>
          <p className="mt-1 text-xs text-app-text-muted">
            Proposed action ({r.action.type}): {r.action.brief}
          </p>
          <table className="mt-2 w-full text-xs">
            <caption className="mb-1 text-left text-app-text-muted">Evidence</caption>
            <thead>
              <tr className="text-left text-app-text-muted">
                <th className="font-normal">Metric</th>
                <th className="font-normal">Id</th>
                <th className="font-normal">Period</th>
                <th className="text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {r.evidence.map((e) => (
                <tr key={e.id} className="border-t border-app-border-subtle">
                  <td className="py-1 text-app-text">{e.label}</td>
                  <td className="font-mono text-[10px] text-app-text-muted">{e.id}</td>
                  <td className="text-app-text-muted">{e.period}</td>
                  <td className="text-right text-app-text">{formatMetricValue(e.value, e.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.status === 'PROPOSED' ? (
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={pending} onClick={() => run(() => decide(r.id, 'approve'))} className="rounded-md border border-app-border-subtle px-2 py-1 text-xs text-app-text disabled:opacity-50">
                Approve
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => decide(r.id, 'reject'))} className="rounded-md border border-app-border-subtle px-2 py-1 text-xs text-app-text-secondary disabled:opacity-50">
                Reject
              </button>
            </div>
          ) : null}
        </article>
      ))}
      {!items.length ? <p className="text-xs text-app-text-muted">No recommendations yet.</p> : null}
    </div>
  );
}

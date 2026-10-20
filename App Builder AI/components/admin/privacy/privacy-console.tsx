'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  completeRequestAction,
  eraseSubjectAction,
  exportSubjectAction,
  runRetentionNowAction,
  savePolicyAction,
  searchSubjectAction,
  withdrawConsentAction,
} from '@/lib/admin/actions/privacy';

type RequestRow = {
  id: string;
  type: string;
  status: string;
  requesterName: string | null;
  email: string | null;
  phone: string | null;
  details: string | null;
  receivedAt: string;
  dueAt: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  sla: { state: string; daysLeft: number | null };
};

type PolicyRow = {
  key: string;
  label: string;
  description: string;
  retentionDays: number;
  enabled: boolean;
  dryRun: boolean;
  lastRunAt: string | null;
  lastRunCount: number | null;
};

type Consent = { key: string; label: string; scope: string; granted: boolean; detail: string; at: string; canWithdraw: boolean };
type SearchResult = { summary: Record<string, number>; total: number; consents: Consent[] };

const button = 'rounded-full border border-app-border-subtle px-3 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50';
const input = 'rounded-md border border-app-border-subtle bg-app-surface px-2 py-1 text-sm text-app-text';
const OUTCOMES = ['FULFILLED', 'PARTIALLY_FULFILLED', 'NO_DATA_FOUND', 'REFUSED'];

function slaLabel(sla: RequestRow['sla']) {
  if (sla.state === 'OVERDUE') return `Overdue by ${Math.abs(sla.daysLeft ?? 0)}d`;
  if (sla.state === 'CLOSED') return 'Closed';
  if (sla.state === 'NOT_STARTED') return 'Awaiting verification';
  return `${sla.daysLeft}d left`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Subject({ canWrite, request, email, phone }: { canWrite: boolean; request: RequestRow | null; email: string; phone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [outcome, setOutcome] = useState('FULFILLED');
  const [note, setNote] = useState('');
  const requestId = request?.id ?? null;
  const open = request && request.status !== 'COMPLETED' && request.status !== 'REJECTED' && request.status !== 'PENDING_VERIFICATION';

  const run = (fn: () => Promise<void>) => start(async () => {
    await fn();
    router.refresh();
  });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() => run(async () => {
            const res = await searchSubjectAction(requestId, { email, phone });
            if ('error' in res) setMessage(res.error);
            else {
              setResult(res);
              setMessage(`${res.total} record(s) found.`);
            }
          })}
        >
          Search records
        </button>
        {canWrite && open ? (
          <>
            <button
              type="button"
              className={button}
              disabled={pending}
              onClick={() => run(async () => {
                const res = await exportSubjectAction(requestId!);
                if ('error' in res) setMessage(res.error);
                else download(`subject-export-${requestId}.json`, res.json);
              })}
            >
              Export data
            </button>
            <button
              type="button"
              className={button}
              disabled={pending}
              onClick={() => run(async () => {
                const confirmation = window.prompt('This permanently erases/anonymises all matching records. Type ERASE to continue.') ?? '';
                const res = await eraseSubjectAction(requestId!, confirmation);
                setMessage('error' in res ? res.error : res.message);
              })}
            >
              Erase / anonymise
            </button>
          </>
        ) : null}
      </div>
      {message ? <p className="text-app-text-secondary">{message}</p> : null}
      {result ? (
        <div className="space-y-2">
          <p className="text-xs text-app-text-muted">
            {Object.entries(result.summary).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'Nothing found.'}
          </p>
          {result.consents.length ? (
            <table className="w-full text-xs">
              <thead className="text-left text-app-text-muted">
                <tr><th className="py-1">Consent</th><th>Scope</th><th>Status</th><th>Detail</th><th /></tr>
              </thead>
              <tbody>
                {result.consents.map((c) => (
                  <tr key={c.key} className="border-t border-app-border-subtle">
                    <td className="py-1">{c.label}</td>
                    <td>{c.scope}</td>
                    <td>{c.granted ? 'Granted' : 'Not granted / opted out'}</td>
                    <td>{c.detail}</td>
                    <td>
                      {canWrite && c.canWithdraw ? (
                        <button
                          type="button"
                          className={button}
                          disabled={pending}
                          onClick={() => run(async () => {
                            const res = await withdrawConsentAction(c.key);
                            setMessage('error' in res ? res.error : res.message);
                          })}
                        >
                          Withdraw
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
      {canWrite && open ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-app-border-subtle pt-3">
          <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ').toLowerCase()}</option>)}
          </select>
          <input className={`${input} min-w-64 flex-1`} placeholder="Outcome note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            className={button}
            disabled={pending}
            onClick={() => run(async () => {
              const res = await completeRequestAction(requestId!, outcome, note);
              setMessage('error' in res ? res.error : res.message);
            })}
          >
            Record outcome and close
          </button>
        </div>
      ) : null}
      {request?.outcome ? <p className="text-xs text-app-text-muted">Outcome: {request.outcome}. {request.outcomeNote}</p> : null}
    </div>
  );
}

function Policy({ policy, canWrite }: { policy: PolicyRow; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [days, setDays] = useState(String(policy.retentionDays));
  const [enabled, setEnabled] = useState(policy.enabled);
  const [dryRun, setDryRun] = useState(policy.dryRun);
  const [message, setMessage] = useState('');

  return (
    <div className="rounded-xl border border-app-border-subtle p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-app-text">{policy.label}</p>
          <p className="text-xs text-app-text-muted">{policy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-app-text-muted">
            Days <input className={`${input} w-20`} value={days} disabled={!canWrite} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="text-xs text-app-text-muted"><input type="checkbox" checked={enabled} disabled={!canWrite} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
          <label className="text-xs text-app-text-muted"><input type="checkbox" checked={dryRun} disabled={!canWrite} onChange={(e) => setDryRun(e.target.checked)} /> Dry run</label>
          {canWrite ? (
            <>
              <button type="button" className={button} disabled={pending} onClick={() => start(async () => {
                const res = await savePolicyAction(policy.key, Number(days), enabled, dryRun);
                setMessage('error' in res ? res.error : res.message);
                router.refresh();
              })}>Save</button>
              <button type="button" className={button} disabled={pending} onClick={() => start(async () => {
                const res = await runRetentionNowAction(policy.key, true);
                setMessage('error' in res ? res.error : `Dry run: ${res.results[0]?.count ?? 0} record(s) would be affected.`);
                router.refresh();
              })}>Dry run now</button>
              <button type="button" className={button} disabled={pending} onClick={() => start(async () => {
                if (!window.confirm(`Permanently purge expired "${policy.label}" data now?`)) return;
                const res = await runRetentionNowAction(policy.key, false);
                setMessage('error' in res ? res.error : `Purged ${res.results[0]?.count ?? 0} record(s).`);
                router.refresh();
              })}>Purge now</button>
            </>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-xs text-app-text-muted">
        {policy.lastRunAt ? `Last run ${new Date(policy.lastRunAt).toLocaleString('en-GB')}: ${policy.lastRunCount ?? 0} record(s).` : 'Never run.'} {message}
      </p>
    </div>
  );
}

export function PrivacyConsole({ canWrite, requests, policies }: { canWrite: boolean; requests: RequestRow[]; policies: PolicyRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const current = requests.find((r) => r.id === selected) ?? null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-medium text-app-text">Request queue</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-app-text-muted">No requests yet. The public form is at /privacy/request.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-app-border-subtle">
            <table className="w-full text-left text-sm">
              <thead className="bg-app-surface text-xs text-app-text-muted">
                <tr><th className="px-3 py-2">Received</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Requester</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">SLA</th></tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className={`cursor-pointer border-t border-app-border-subtle text-app-text hover:bg-app-surface-hover ${r.id === selected ? 'bg-app-surface' : ''}`} onClick={() => setSelected(r.id)}>
                    <td className="px-3 py-2">{new Date(r.receivedAt).toLocaleDateString('en-GB')}</td>
                    <td className="px-3 py-2">{r.type}</td>
                    <td className="px-3 py-2">{r.requesterName || r.email || '(removed)'}</td>
                    <td className="px-3 py-2">{r.status.replaceAll('_', ' ')}</td>
                    <td className={`px-3 py-2 ${r.sla.state === 'OVERDUE' ? 'text-red-400' : r.sla.state === 'DUE_SOON' ? 'text-amber-400' : ''}`}>{slaLabel(r.sla)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {current ? (
          <div className="mt-4 rounded-xl border border-app-border-subtle p-4">
            <p className="mb-1 text-sm text-app-text">{current.type} request from {current.email ?? '(contact details removed)'} {current.phone ? `/ ${current.phone}` : ''}</p>
            {current.details ? <p className="mb-3 text-xs text-app-text-muted">{current.details}</p> : null}
            <Subject key={current.id} canWrite={canWrite} request={current} email="" phone="" />
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-app-text">Look up a person and manage consents</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Subject key={`${email}|${phone}`} canWrite={canWrite} request={null} email={email} phone={phone} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-app-text">Retention policies</h2>
        <p className="mb-3 text-xs text-app-text-muted">Policies are off and in dry-run until enabled. The hourly job purges only enabled, non-dry-run policies. Every run is audited. Billing records are never purged.</p>
        <div className="space-y-2">
          {policies.map((p) => <Policy key={p.key} policy={p} canWrite={canWrite} />)}
        </div>
      </section>
    </div>
  );
}

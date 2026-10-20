'use client';

import { useState, useTransition } from 'react';

import { decideProjectActivityAction } from '@/lib/agents/project-actions';
import { AGENT_LABELS, isAgentRole } from '@/lib/agents/types';

import { AgentCard, type AgentSettingProps } from './agent-card';

type Activity = {
  id: string;
  agent: string;
  action: string;
  status: string;
  risk: string;
  inputSummary: string | null;
  resultSummary: string | null;
  decisionReason: string | null;
  error: string | null;
  costCents: number;
  createdAt: string;
};

const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';

function ActivityRow({ projectId, activity }: { projectId: string; activity: Activity }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const waiting = activity.status === 'AWAITING_APPROVAL' || activity.status === 'PLANNED';
  const act = (decision: 'approve' | 'reject' | 'retry' | 'pause') =>
    start(async () => {
      const result = await decideProjectActivityAction(projectId, activity.id, decision);
      setError('error' in result ? result.error : '');
    });
  return (
    <li className="space-y-1 rounded-xl border border-app-border-subtle p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-app-text">{activity.action}</strong>
        <span className="text-app-text-muted">
          {isAgentRole(activity.agent) ? AGENT_LABELS[activity.agent].label : activity.agent} · {activity.status} · risk {activity.risk} · {new Date(activity.createdAt).toLocaleString()}
        </span>
      </div>
      {activity.inputSummary ? <p className="text-app-text-secondary">{activity.inputSummary}</p> : null}
      {activity.resultSummary ? <p className="text-app-text-secondary">Result: {activity.resultSummary}</p> : null}
      {activity.decisionReason ? <p className="text-xs text-app-text-muted">{activity.decisionReason}</p> : null}
      {activity.error ? <p className="text-xs text-red-500">{activity.error}</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {waiting ? (
          <>
            <button className={btn} disabled={pending} onClick={() => act('approve')}>Approve</button>
            <button className={btn} disabled={pending} onClick={() => act('reject')}>Reject</button>
            <button className={btn} disabled={pending} onClick={() => act('pause')}>Pause</button>
          </>
        ) : null}
        {activity.status === 'FAILED' || activity.status === 'BLOCKED' ? (
          <button className={btn} disabled={pending} onClick={() => act('retry')}>Retry</button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </li>
  );
}

export function AgentsPanel({
  projectId,
  projectName,
  builderHref,
  settings,
  activities,
}: {
  projectId: string;
  projectName: string;
  builderHref: string;
  settings: AgentSettingProps[];
  activities: Activity[];
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-app-text">AI agents — {projectName}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">
            Every agent is off until you enable it. Start with Assist, move to Approval, and only choose Autonomous for actions you trust.
          </p>
        </div>
        <a className={btn} href={builderHref}>Back to builder</a>
      </div>
      <ul className="space-y-4">
        {settings.map((setting) => (
          <AgentCard key={setting.agent} projectId={projectId} setting={setting} />
        ))}
      </ul>
      <section className="space-y-3">
        <h2 className="text-lg text-app-text">Activity</h2>
        {activities.length === 0 ? (
          <p className="text-sm text-app-text-muted">No agent activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {activities.map((activity) => (
              <ActivityRow key={activity.id} projectId={projectId} activity={activity} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

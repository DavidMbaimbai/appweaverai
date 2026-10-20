'use client';

import { useState, useTransition } from 'react';

import { saveProjectAgentAction, setProjectAgentStateAction } from '@/lib/agents/project-actions';
import {
  AGENT_CATEGORIES,
  AGENT_LABELS,
  AGENT_MODES,
  MODE_EXPLANATIONS,
  type AgentModeName,
  type AgentRole,
} from '@/lib/agents/types';

export type AgentSettingProps = {
  agent: AgentRole;
  mode: AgentModeName;
  enabled: boolean;
  paused: boolean;
  categories: string[];
  dailyActionLimit: number;
  dailyBudgetCents: number;
  authorisedAt: string | null;
};

const field = 'w-full rounded-lg border border-app-border bg-transparent px-3 py-2 text-sm text-app-text';
const btn = 'rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-border-subtle disabled:opacity-50';

export function AgentCard({ projectId, setting }: { projectId: string; setting: AgentSettingProps }) {
  const [mode, setMode] = useState(setting.mode);
  const [enabled, setEnabled] = useState(setting.enabled);
  const [categories, setCategories] = useState(setting.categories);
  const [limit, setLimit] = useState(String(setting.dailyActionLimit));
  const [budget, setBudget] = useState((setting.dailyBudgetCents / 100).toString());
  const [authorise, setAuthorise] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const meta = AGENT_LABELS[setting.agent];
  const needsAuth = mode === 'AUTONOMOUS' && !setting.authorisedAt;

  function run(fn: () => Promise<{ success: true } | { error: string }>, ok: string) {
    start(async () => {
      const result = await fn();
      setMessage('error' in result ? result.error : ok);
    });
  }

  return (
    <li className="space-y-3 rounded-xl border border-app-border-subtle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-app-text">{meta.label}</strong>
        <span className="text-sm text-app-text-muted">{meta.description}</span>
        {setting.paused ? <span className="text-xs font-medium text-red-500">Paused</span> : null}
        <span className="ml-auto flex gap-2">
          <button className={btn} disabled={pending} onClick={() => run(() => setProjectAgentStateAction(projectId, setting.agent, setting.paused ? 'resume' : 'pause'), setting.paused ? 'Resumed.' : 'Paused.')}>
            {setting.paused ? 'Resume' : 'Pause now'}
          </button>
          {setting.enabled ? (
            <button className={btn} disabled={pending} onClick={() => { setEnabled(false); run(() => setProjectAgentStateAction(projectId, setting.agent, 'disable'), 'Disabled.'); }}>
              Disable now
            </button>
          ) : null}
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm text-app-text">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable this agent
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        {AGENT_MODES.map((m) => (
          <label key={m} className={`cursor-pointer rounded-lg border p-3 text-sm ${mode === m ? 'border-appweaver-orange' : 'border-app-border'}`}>
            <input type="radio" className="mr-2" name={`mode-${setting.agent}`} checked={mode === m} onChange={() => setMode(m)} />
            <span className="font-medium text-app-text">{m === 'ASSIST' ? 'Assist' : m === 'APPROVAL' ? 'Approval' : 'Autonomous'}</span>
            <p className="mt-1 text-xs text-app-text-muted">{MODE_EXPLANATIONS[m]}</p>
          </label>
        ))}
      </div>

      {mode === 'AUTONOMOUS' ? (
        <div className="space-y-2">
          <p className="text-sm text-app-text">Actions it may run by itself:</p>
          <div className="flex flex-wrap gap-3 text-sm text-app-text">
            {AGENT_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" checked={categories.includes(c)} onChange={(e) => setCategories(e.target.checked ? [...categories, c] : categories.filter((x) => x !== c))} />
                {c.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
          {setting.authorisedAt ? (
            <p className="text-xs text-app-text-muted">Authorised on {new Date(setting.authorisedAt).toLocaleString()}.</p>
          ) : (
            <label className="flex items-start gap-2 text-sm text-app-text">
              <input type="checkbox" className="mt-1" checked={authorise} onChange={(e) => setAuthorise(e.target.checked)} />
              I authorise this agent to act on my behalf in the categories above, within the limits below. I understand risky actions will still ask me first, and that I can pause it at any time.
            </label>
          )}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-app-text">
          Max actions per day
          <input className={field} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm text-app-text">
          Max spend per day (USD)
          <input className={field} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          className={btn}
          disabled={pending || (needsAuth && !authorise)}
          onClick={() =>
            run(
              () =>
                saveProjectAgentAction(projectId, setting.agent, {
                  mode,
                  enabled,
                  categories,
                  dailyActionLimit: Number(limit),
                  dailyBudgetCents: Math.round(Number(budget) * 100),
                  authorise,
                }),
              'Saved.',
            )
          }>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {message ? <span className="text-sm text-app-text-muted">{message}</span> : null}
      </div>
    </li>
  );
}

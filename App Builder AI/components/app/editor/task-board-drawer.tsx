'use client';

import { useMemo } from 'react';

import type { AgentStep } from '@/lib/agent/types';

import { AgentActivityPulse } from './agent-activity-indicator';

type TaskBoardDrawerProps = {
  open: boolean;
  onClose: () => void;
  steps: AgentStep[];
};

const columns = [
  { id: 'drafts', label: 'Drafts' },
  { id: 'active', label: 'Active' },
  { id: 'ready', label: 'Ready' },
  { id: 'done', label: 'Done' },
] as const;

function distributeSteps(steps: AgentStep[]) {
  const actionSteps = steps.filter((step) => step.type === 'action');
  if (actionSteps.length === 0) {
    return {
      drafts: [] as AgentStep[],
      active: [] as AgentStep[],
      ready: [] as AgentStep[],
      done: [] as AgentStep[],
    };
  }

  const last = actionSteps.at(-1);
  const rest = actionSteps.slice(0, -1);
  const midpoint = Math.ceil(rest.length / 2);

  return {
    drafts: rest.slice(0, Math.max(1, Math.floor(rest.length / 3))),
    active: rest.slice(Math.max(1, Math.floor(rest.length / 3)), midpoint),
    ready: rest.slice(midpoint),
    done: last ? [last] : [],
  };
}

export function TaskBoardDrawer({
  open,
  onClose,
  steps,
}: TaskBoardDrawerProps) {
  const grouped = useMemo(() => distributeSteps(steps), [steps]);

  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 border-t border-app-border bg-app-sidebar-bg/95 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-app-border-subtle px-4 py-2">
        <h3 className="text-sm font-medium text-app-text">Agent task board</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-app-text-muted transition-colors hover:text-app-text-secondary">
          Close
        </button>
      </div>

      <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto px-4 py-3 tablet-up:grid-cols-4">
        {columns.map((column) => {
          const items = grouped[column.id];
          return (
            <div
              key={column.id}
              className="rounded-xl border border-app-border bg-app-surface/80 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
                  {column.label}
                </span>
                <span className="rounded-full bg-app-surface-active px-1.5 py-0.5 text-[10px] text-app-text-muted">
                  {items.length}
                </span>
              </div>
              {items.length > 0 ? (
                <ul className="space-y-1.5">
                  {items.map((step, index) => (
                    <li
                      key={`${column.id}-${index}`}
                      className="rounded-lg border border-app-border-subtle bg-app-surface-active px-2.5 py-2 text-xs text-app-text-secondary">
                      {step.type === 'action' ? step.label : step.content}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-xs text-app-text-muted/70">No tasks</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WorkingIndicator({ actionCount }: { actionCount: number }) {
  return (
    <div className="flex items-center gap-2 text-sm text-app-text-secondary">
      <AgentActivityPulse label="Agent working" />
      <span>Working…</span>
      {actionCount > 0 ? (
        <span className="text-xs text-app-text-muted">
          {actionCount} {actionCount === 1 ? 'action' : 'actions'}
        </span>
      ) : null}
    </div>
  );
}

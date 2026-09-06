'use client';

import type { AgentStep } from '@/lib/agent/types';
import { dedupeActionSteps } from '@/lib/agent/step-utils';
import { cn } from '@/lib/utils';

import { AgentActivityPulse } from './agent-activity-indicator';

type AgentActionStepsProps = {
  steps: AgentStep[];
  expanded?: boolean;
  onToggle?: () => void;
  live?: boolean;
  className?: string;
};

function StepIcon({ status }: { status?: 'running' | 'done' }) {
  if (status === 'running') {
    return (
      <span
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden="true">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-replit-orange/30 border-t-replit-orange" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-replit-orange/15 text-[10px] font-semibold text-replit-orange"
      aria-hidden="true">
      ✓
    </span>
  );
}

export function AgentActionSteps({
  steps,
  expanded = false,
  onToggle,
  live = false,
  className,
}: AgentActionStepsProps) {
  const actionSteps = dedupeActionSteps(
    steps.filter((step) => step.type === 'action'),
  );
  if (actionSteps.length === 0) return null;

  const showList = live || expanded;
  const runningCount = actionSteps.filter(
    (step) => step.type === 'action' && step.status === 'running',
  ).length;

  return (
    <div className={cn('space-y-2', className)}>
      {!live && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-surface px-3 py-1 text-xs text-app-text-secondary transition-colors hover:bg-app-surface-hover">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-replit-orange/15 text-[10px] font-semibold text-replit-orange">
            {actionSteps.length}
          </span>
          {actionSteps.length === 1 ? 'action' : 'actions'}
          <span className="text-app-text-muted">{expanded ? '▴' : '▾'}</span>
        </button>
      ) : live ? (
        <div className="inline-flex items-center gap-2 text-xs text-app-text-muted">
          <AgentActivityPulse label="Agent working" />
          {runningCount > 0 ? 'Working…' : 'Finishing up…'}
        </div>
      ) : null}

      {showList ? (
        <ul
          className={cn(
            'space-y-1.5 rounded-xl border border-app-border-subtle bg-app-surface/60 p-3',
            live && 'border-replit-orange/20 bg-app-surface/80',
          )}>
          {actionSteps.map((step, index) => {
            if (step.type !== 'action') return null;
            return (
              <li
                key={`${step.path ?? step.label}-${index}`}
                className={cn(
                  'flex items-start gap-2.5 text-xs transition-opacity',
                  step.status === 'running'
                    ? 'rounded-lg bg-replit-orange/5 px-2 py-1.5 text-app-text'
                    : step.status === 'done'
                      ? 'text-app-text-secondary'
                      : 'text-app-text',
                )}>
                <StepIcon status={step.status} />
                <span>{step.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

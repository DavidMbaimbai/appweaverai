'use client';

import { cn } from '@/lib/utils';

type AgentPlanQuestionProps = {
  options: string[];
  onSelect: (option: string) => void;
  disabled?: boolean;
  className?: string;
};

export function AgentPlanQuestion({
  options,
  onSelect,
  disabled = false,
  className,
}: AgentPlanQuestionProps) {
  return (
    <div
      className={cn('mt-2 flex w-full max-w-full flex-col gap-1.5', className)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option)}
          className={cn(
            'rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-left text-sm text-app-text-secondary transition-colors',
            'hover:border-replit-orange/40 hover:bg-app-surface-hover hover:text-app-text',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-replit-orange/60',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}>
          {option}
        </button>
      ))}
    </div>
  );
}

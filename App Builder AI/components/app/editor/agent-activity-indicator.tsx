'use client';

import { cn } from '@/lib/utils';

type AgentActivityPulseProps = {
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
};

export function AgentActivityPulse({
  className,
  size = 'sm',
  label = 'Agent is working',
}: AgentActivityPulseProps) {
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  return (
    <span
      className={cn('relative inline-flex shrink-0', dotSize, className)}
      role="status"
      aria-label={label}>
      <span
        className={cn(
          'absolute inline-flex animate-ping rounded-full bg-replit-orange/70 opacity-75',
          dotSize,
        )}>
        <span
          className={cn(
            'relative inline-flex rounded-full bg-replit-orange',
            dotSize,
          )}
        />
      </span>
    </span>
  );
}

type AgentWorkingBadgeProps = {
  label: string;
  className?: string;
};

export function AgentWorkingBadge({
  label,
  className,
}: AgentWorkingBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-replit-orange/30 bg-replit-orange/10 px-2 py-0.5 text-[10px] font-medium text-replit-orange',
        className,
      )}>
      <AgentActivityPulse size="sm" label={label} />
      <span className="truncate">{label}</span>
    </span>
  );
}

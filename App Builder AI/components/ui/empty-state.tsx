import {
  type UiTheme,
  emptyStateDescriptionStyles,
  emptyStateStyles,
  emptyStateTitleStyles,
  mutedTextStyles,
} from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

type EmptyStateProps = {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  theme?: UiTheme;
};

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  theme = 'light',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border px-6 py-16 text-center',
        emptyStateStyles[theme],
        className,
      )}>
      {icon ? (
        <div className={cn('mb-4', mutedTextStyles[theme])}>{icon}</div>
      ) : null}
      <h3 className={cn('font-display text-xl', emptyStateTitleStyles[theme])}>
        {title}
      </h3>
      <p
        className={cn(
          'mt-2 max-w-sm text-sm',
          emptyStateDescriptionStyles[theme],
        )}>
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

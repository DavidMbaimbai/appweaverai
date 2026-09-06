import {
  focusRingStyles,
  inputStyles,
  mutedTextStyles,
  type UiTheme,
} from '@/lib/ui-theme';
import { ChevronIcon } from './chevron-icon';
import { cn } from '@/lib/utils';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  theme?: UiTheme;
};

const hoverStyles: Record<UiTheme, string> = {
  light: 'hover:border-text-muted/40 hover:bg-pricing-surface',
  app: 'hover:border-app-text-muted/50 hover:bg-app-surface-hover',
};

export function Select({
  className,
  children,
  theme = 'light',
  ...props
}: SelectProps) {
  return (
    <div className={cn('relative inline-flex w-full', className)}>
      <select
        className={cn(
          'h-9 w-full cursor-pointer appearance-none rounded-lg border py-0 pl-3 pr-9 text-sm transition-[border-color,box-shadow,background-color]',
          inputStyles[theme],
          hoverStyles[theme],
          focusRingStyles[theme],
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}>
        {children}
      </select>
      <span
        className={cn(
          'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2',
          mutedTextStyles[theme],
        )}
        aria-hidden="true">
        <ChevronIcon direction="down" size={14} />
      </span>
    </div>
  );
}

import { badgeVariantStyles, type UiTheme } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'orange' | 'muted' | 'success' | 'info';

type BadgeProps = {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  theme?: UiTheme;
};

export function Badge({
  children,
  variant = 'default',
  className,
  theme = 'light',
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        badgeVariantStyles[variant][theme],
        className,
      )}>
      {children}
    </span>
  );
}

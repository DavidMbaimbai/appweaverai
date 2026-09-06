import { cn } from '@/lib/utils';

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
};

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-replit-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-replit-orange' : 'bg-app-surface-active',
      )}>
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

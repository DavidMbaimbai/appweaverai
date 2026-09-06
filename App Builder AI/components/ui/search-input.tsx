import { mutedTextStyles, type UiTheme } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';
import { Input } from './input';

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  theme?: UiTheme;
};

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search projects...',
  className,
  theme = 'light',
}: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <svg
        className={cn(
          'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2',
          mutedTextStyles[theme],
        )}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true">
        <path
          d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M16 16l5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
        theme={theme}
      />
    </div>
  );
}

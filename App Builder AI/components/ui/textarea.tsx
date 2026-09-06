import { inputStyles, UiTheme } from '@/lib/ui-theme';
import { focusRingStyles } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  theme?: UiTheme;
};

export function Textarea({
  className,
  theme = 'light',
  ...props
}: TextareaProps) {
  return (
    <textarea
      className={cn(
        'min-h-[88px] w-full resize-y rounded-xl border px-3.5 py-3 text-sm transition-[border-color,box-shadow]',
        inputStyles[theme],
        focusRingStyles[theme],
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

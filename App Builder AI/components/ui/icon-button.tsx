import type { UiTheme } from "@/lib/ui-theme";
import {
  focusVisibleRingStyles,
  iconButtonGhostStyles,
  iconButtonOutlineStyles,
} from "@/lib/ui-theme";
import { cn } from "@/lib/utils";

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "outline";
  theme?: UiTheme;
};

const sizeStyles = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

export function IconButton({
  label,
  size = "md",
  variant = "ghost",
  theme = "light",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition-colors",
        "focus-visible:outline-none focus-visible:ring-2",
        focusVisibleRingStyles[theme],
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizeStyles[size],
        variant === "ghost" ? iconButtonGhostStyles[theme] : iconButtonOutlineStyles[theme],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

import { cn } from '@/lib/utils';

type AppWeaverLogoProps = {
  className?: string;
  size?: 'default' | 'compact';
};

const containerSizeStyles = {
  default: 'gap-2.5 text-[22px]',
  compact: 'gap-1.5 text-sm',
};

const iconSizeStyles = {
  default: 'h-9 w-9',
  compact: 'h-6 w-6',
};

const ACCENT = '#FF3C00';
const ACCENT_LIGHT = '#FF7A45';

export function AppWeaverLogo({ className, size = 'default' }: AppWeaverLogoProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-display font-semibold leading-none tracking-tight',
        containerSizeStyles[size],
        className,
      )}
      role="img"
      aria-label="AppWeaver AI">
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(iconSizeStyles[size], 'shrink-0')}
        aria-hidden="true">
        <defs>
          <linearGradient id="AppWeaver-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={ACCENT_LIGHT} />
            <stop offset="1" stopColor={ACCENT} />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#AppWeaver-mark)" />
        {/* Loom frame — top beam doubles as the reed/beater with comb teeth */}
        <path
          d="M8 8H24M9.5 8V10M12.5 8V10M15.5 8V10M18.5 8V10M21.5 8V10M22.5 8V10"
          stroke="#FFFFFF"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M8 8V25M24 8V25" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
        <path d="M8 25H24" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
        {/* Warp threads */}
        <path
          d="M12 11V25M16 11V25M20 11V25"
          stroke="#FFFFFF"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.55"
        />
        {/* Shuttle / weaving needle gliding through the warp */}
        <path
          d="M6.5 17C10 13.5 22 13.5 25.5 17C22 20.5 10 20.5 6.5 17Z"
          fill="#FFFFFF"
        />
        <circle cx="16" cy="17" r="1.7" fill={ACCENT} />
      </svg>
      <span className="whitespace-nowrap">
        AppWeaver <span style={{ color: ACCENT }}>AI</span>
      </span>
    </span>
  );
}


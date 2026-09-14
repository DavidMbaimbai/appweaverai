import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'bg-app-surface-active text-app-text-secondary',
  success: 'bg-emerald-950/50 text-emerald-400',
  warning: 'bg-amber-950/50 text-amber-400',
  danger: 'bg-red-950/50 text-red-400',
  info: 'bg-sky-950/50 text-sky-400',
} as const;

export type PillTone = keyof typeof TONES;

/** Small status pill used across Admin Console tables/detail pages. */
export function StatusPill({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}>
      {children}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <p className="text-xs font-medium text-app-text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-app-text">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-app-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-app-text">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-app-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function AdminEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-app-border-subtle p-10 text-center text-sm text-app-text-muted">
      {message}
    </div>
  );
}

export function formatCurrencyCents(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDateTime(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

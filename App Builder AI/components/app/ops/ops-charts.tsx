import type { DayBucket, WeekBucket } from '@/lib/ops/aggregate';

export const COLORS = { success: '#10b981', failed: '#ef4444', running: '#f59e0b' } as const;

export function DeploymentsPerDayChart({ buckets }: { buckets: DayBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const width = 600;
  const height = 160;
  const slot = width / buckets.length;
  const barWidth = Math.max(2, slot * 0.7);
  const total = buckets.reduce((n, b) => n + b.total, 0);

  return (
    <svg
      viewBox={`0 0 ${width} ${height + 18}`}
      role="img"
      aria-label={`Deployments per day, ${total} in the last ${buckets.length} days`}
      className="h-48 w-full">
      <line x1="0" y1={height} x2={width} y2={height} stroke="currentColor" className="text-app-border-subtle" />
      {buckets.map((bucket, i) => {
        const x = i * slot + (slot - barWidth) / 2;
        let y = height;
        const segments = (['success', 'failed', 'running'] as const).map((key) => {
          const h = (bucket[key] / max) * (height - 8);
          y -= h;
          return h > 0 ? <rect key={key} x={x} y={y} width={barWidth} height={h} fill={COLORS[key]} /> : null;
        });
        return (
          <g key={bucket.day}>
            <title>{`${bucket.day}: ${bucket.total} deployment${bucket.total === 1 ? '' : 's'} (${bucket.success} succeeded, ${bucket.failed} failed, ${bucket.running} running)`}</title>
            {segments}
            {i % Math.ceil(buckets.length / 7) === 0 ? (
              <text x={x + barWidth / 2} y={height + 14} textAnchor="middle" fontSize="10" fill="currentColor" className="text-app-text-muted">
                {bucket.day.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function StatusDonut({ counts }: { counts: { success: number; failed: number; running: number } }) {
  const total = counts.success + counts.failed + counts.running;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Status distribution: ${counts.success} successful, ${counts.failed} failed, ${counts.running} running`}
        className="h-32 w-32 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="12" className="text-app-surface" />
        {total > 0
          ? (['success', 'failed', 'running'] as const).map((key) => {
              const length = (counts[key] / total) * circumference;
              const circle = counts[key] > 0 ? (
                <circle
                  key={key}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={COLORS[key]}
                  strokeWidth="12"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                />
              ) : null;
              offset += length;
              return circle;
            })
          : null}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {(
          [
            ['success', 'Successful'],
            ['failed', 'Failed'],
            ['running', 'Running'],
          ] as const
        ).map(([key, label]) => (
          <li key={key} className="flex items-center gap-2 text-app-text-secondary">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[key] }} />
            {label}: <span className="font-medium text-app-text">{counts[key]}</span>
            {total > 0 ? <span className="text-xs text-app-text-muted">({Math.round((counts[key] / total) * 100)}%)</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeeklyTrendChart({ weeks }: { weeks: WeekBucket[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.total));
  return (
    <div role="img" aria-label={`Weekly deployments: ${weeks.map((w) => w.total).join(', ')}`} className="flex h-40 items-end gap-2">
      {weeks.map((week) => (
        <div key={week.weekStart} className="flex h-full flex-1 flex-col justify-end gap-1" title={`Week from ${week.weekStart}: ${week.total} deployments, ${week.failed} failed`}>
          <span className="text-center text-[10px] text-app-text-muted">{week.total}</span>
          <div className="flex w-full flex-col justify-end overflow-hidden rounded-t" style={{ height: `${(week.total / max) * 85}%`, minHeight: week.total > 0 ? 4 : 2 }}>
            <div style={{ flex: week.failed, backgroundColor: COLORS.failed }} />
            <div style={{ flex: Math.max(week.total - week.failed, week.total === 0 ? 1 : 0), backgroundColor: week.total === 0 ? 'rgb(120 120 120 / 0.3)' : COLORS.success }} />
          </div>
          <span className="text-center text-[10px] text-app-text-muted">{week.weekStart.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function RateBar({ label, rate, total }: { label: string; rate: number | null; total: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-app-text-secondary">{label}</span>
        <span className="font-medium">{rate === null ? 'No finished deployments' : `${rate}%`}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} success rate`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rate ?? undefined}
        className="mt-1 h-2 overflow-hidden rounded-full bg-app-surface">
        <div className="h-full rounded-full" style={{ width: `${rate ?? 0}%`, backgroundColor: COLORS.success }} />
      </div>
      <p className="mt-0.5 text-xs text-app-text-muted">{total} deployment{total === 1 ? '' : 's'} in range</p>
    </div>
  );
}

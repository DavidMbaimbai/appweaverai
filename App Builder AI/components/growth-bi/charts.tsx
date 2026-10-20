const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444', '#64748b'];
export const chartColor = (i: number) => COLORS[i % COLORS.length];

function path(values: number[], w: number, h: number, pad = 2) {
  if (values.length < 2) return '';
  const max = Math.max(...values, 1);
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + (i * (w - pad * 2)) / (values.length - 1)).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  return (
    <svg role="img" aria-label={label} viewBox="0 0 120 32" className="h-8 w-full text-indigo-500">
      <path d={path(values, 120, 32)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendLine({ series, labels, height = 140 }: { series: { name: string; values: number[] }[]; labels: string[]; height?: number }) {
  const w = 600;
  return (
    <div>
      <svg role="img" aria-label={`Trend of ${series.map((s) => s.name).join(', ')}`} viewBox={`0 0 ${w} ${height}`} className="w-full">
        {series.map((s, i) => (
          <path key={s.name} d={path(s.values, w, height, 6)} fill="none" stroke={chartColor(i)} strokeWidth="2" strokeLinejoin="round" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-app-text-muted">
        <span>{labels[0]}</span>
        <span className="flex gap-3">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: chartColor(i) }} />
              {s.name}
            </span>
          ))}
        </span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

export function Donut({ slices, centre }: { slices: { name: string; value: number }[]; centre?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg role="img" aria-label="Share by channel" viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" className="text-app-border-subtle" strokeWidth="14" />
        {total > 0 &&
          slices.map((s, i) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.name} cx="50" cy="50" r={r} fill="none" stroke={chartColor(i)} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
        {centre ? (
          <text x="50" y="54" textAnchor="middle" className="rotate-90 fill-current text-[14px] font-semibold text-app-text" transform="rotate(90 50 50)">
            {centre}
          </text>
        ) : null}
      </svg>
      <ul className="min-w-0 space-y-1 text-xs">
        {slices.slice(0, 8).map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: chartColor(i) }} />
            <span className="truncate text-app-text-secondary">{s.name}</span>
            <span className="ml-auto pl-2 text-app-text">{total ? `${Math.round((s.value / total) * 100)}%` : '0%'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Bars({ rows, format = (n: number) => String(n) }: { rows: { name: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2 text-xs">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex justify-between text-app-text-secondary">
            <span className="truncate">{r.name}</span>
            <span className="text-app-text">{format(r.value)}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-app-border-subtle">
            <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="text-sm font-semibold text-app-text">{title}</h2>
      {hint ? <p className="mb-3 mt-0.5 text-xs text-app-text-muted">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

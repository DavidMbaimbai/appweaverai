import type { HistoryPoint } from '@/lib/code-scan/score';

export const SEVERITY_COLORS = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#38bdf8',
} as const;

export function scoreColor(score: number) {
  return score >= 90 ? '#22c55e' : score >= 75 ? '#84cc16' : score >= 60 ? '#eab308' : score >= 40 ? '#f97316' : '#dc2626';
}

export function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const radius = 54;
  const circumference = Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <svg viewBox="0 0 140 90" role="img" aria-label={`Quality score ${score} out of 100, grade ${grade}`} className="w-full max-w-[220px]">
      <path d="M 16 76 A 54 54 0 0 1 124 76" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="12" strokeLinecap="round" />
      <path
        d="M 16 76 A 54 54 0 0 1 124 76"
        fill="none"
        stroke={scoreColor(score)}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
      />
      <text x="70" y="62" textAnchor="middle" fontSize="28" fontWeight="600" fill="currentColor">
        {score}
      </text>
      <text x="70" y="80" textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.7">
        Grade {grade}
      </text>
    </svg>
  );
}

export function SeverityDonut({ counts }: { counts: Record<keyof typeof SEVERITY_COLORS, number> }) {
  const entries = (Object.keys(SEVERITY_COLORS) as Array<keyof typeof SEVERITY_COLORS>).map((k) => ({ key: k, value: counts[k] }));
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${total} open findings by severity`} className="h-28 w-28 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="14" />
        {total > 0
          ? entries
              .filter((e) => e.value > 0)
              .map((e) => {
                const length = (e.value / total) * circumference;
                const circle = (
                  <circle
                    key={e.key}
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={SEVERITY_COLORS[e.key]}
                    strokeWidth="14"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return circle;
              })
          : null}
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="600" fill="currentColor" className="rotate-90 origin-center">
          {total}
        </text>
      </svg>
      <ul className="space-y-1 text-sm">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_COLORS[e.key] }} />
            <span className="w-16 capitalize">{e.key.toLowerCase()}</span>
            <span className="font-medium">{e.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarList({ rows, emptyText }: { rows: Array<{ label: string; value: number; hint?: string }>; emptyText: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-app-text-secondary">{emptyText}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate font-mono text-xs" title={row.label}>
              {row.label}
            </span>
            <span className="shrink-0">{row.hint ?? row.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-app-surface">
            <div className="h-2 rounded-full bg-app-accent" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TrendLine({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return <p className="text-sm text-app-text-secondary">Run at least two scans to see a trend.</p>;
  const width = 280;
  const height = 70;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(height - (p.score / 100) * height).toFixed(1)}`);
  return (
    <svg viewBox={`-4 -4 ${width + 8} ${height + 8}`} role="img" aria-label="Quality score over recent scans" className="w-full">
      <polyline points={coords.join(' ')} fill="none" stroke="#38bdf8" strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={p.id} cx={i * step} cy={height - (p.score / 100) * height} r="3" fill={scoreColor(p.score)}>
          <title>{`${new Date(p.createdAt).toLocaleString()}: ${p.score}`}</title>
        </circle>
      ))}
    </svg>
  );
}

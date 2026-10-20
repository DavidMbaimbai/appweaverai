import type { StoredFinding } from './service';

/** Penalty points per finding. Published in the UI so the score is never a black box. */
export const SEVERITY_WEIGHTS = { CRITICAL: 25, HIGH: 10, MEDIUM: 3, LOW: 1, INFO: 0 } as const;
/** Acknowledged findings are still risk the owner has accepted, so they count at half weight. */
export const ACKNOWLEDGED_FACTOR = 0.5;
/** One severity can remove at most this many points, so a pile of lows cannot zero the score. */
export const MAX_PENALTY_PER_SEVERITY = 60;

export const SCORE_FORMULA =
  'Score = 100 − Σ penalties. Each open finding costs 25 (critical), 10 (high), 3 (medium) or 1 (low); acknowledged findings cost half. Each severity is capped at 60 points. Fixed findings cost nothing.';

type ScoreSeverity = keyof typeof SEVERITY_WEIGHTS;
export type ScoreInput = Pick<StoredFinding, 'severity' | 'status'>;

export type ScoreBreakdownRow = { severity: ScoreSeverity; open: number; acknowledged: number; penalty: number };

export type QualityScore = {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: ScoreBreakdownRow[];
};

export function gradeFor(score: number): QualityScore['grade'] {
  return score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
}

export function computeQualityScore(findings: ScoreInput[]): QualityScore {
  const breakdown: ScoreBreakdownRow[] = (Object.keys(SEVERITY_WEIGHTS) as ScoreSeverity[]).map((severity) => {
    const open = findings.filter((f) => f.severity === severity && f.status === 'OPEN').length;
    const acknowledged = findings.filter((f) => f.severity === severity && f.status === 'ACKNOWLEDGED').length;
    const raw = (open + acknowledged * ACKNOWLEDGED_FACTOR) * SEVERITY_WEIGHTS[severity];
    return { severity, open, acknowledged, penalty: Math.min(raw, MAX_PENALTY_PER_SEVERITY) };
  });
  const total = breakdown.reduce((sum, row) => sum + row.penalty, 0);
  const score = Math.max(0, Math.round(100 - total));
  return { score, grade: gradeFor(score), breakdown };
}

export type AgeBucket = { label: string; count: number };

/** Open (not acknowledged, not fixed) findings grouped by how long ago they were first seen. */
export function bucketByAge(findings: Array<Pick<StoredFinding, 'status' | 'firstSeenAt'>>, now = new Date()): AgeBucket[] {
  const buckets: AgeBucket[] = [
    { label: '< 1 day', count: 0 },
    { label: '1–7 days', count: 0 },
    { label: '1–4 weeks', count: 0 },
    { label: '> 4 weeks', count: 0 },
  ];
  for (const f of findings) {
    if (f.status !== 'OPEN') continue;
    const ageDays = f.firstSeenAt ? (now.getTime() - new Date(f.firstSeenAt).getTime()) / 86_400_000 : 0;
    const index = ageDays < 1 ? 0 : ageDays < 7 ? 1 : ageDays < 28 ? 2 : 3;
    buckets[index].count++;
  }
  return buckets;
}

/** Files with the most open findings, weighted by severity so one critical outranks several lows. */
export function topFiles(findings: Array<Pick<StoredFinding, 'file' | 'severity' | 'status'>>, limit = 5) {
  const byFile = new Map<string, { file: string; count: number; weight: number }>();
  for (const f of findings) {
    if (f.status !== 'OPEN') continue;
    const row = byFile.get(f.file) ?? { file: f.file, count: 0, weight: 0 };
    row.count++;
    row.weight += SEVERITY_WEIGHTS[f.severity as ScoreSeverity] ?? 0;
    byFile.set(f.file, row);
  }
  return [...byFile.values()].sort((a, b) => b.weight - a.weight || b.count - a.count || a.file.localeCompare(b.file)).slice(0, limit);
}

export type HistoryPoint = { id: string; createdAt: string; score: number; critical: number; high: number; medium: number; low: number };

/** Score per past run from stored counts (acknowledgements are not tracked per run, so open weights are used). */
export function scoreFromCounts(counts: { critical: number; high: number; medium: number; low: number }) {
  const findings: ScoreInput[] = [
    ...Array.from({ length: counts.critical }, () => ({ severity: 'CRITICAL', status: 'OPEN' as const })),
    ...Array.from({ length: counts.high }, () => ({ severity: 'HIGH', status: 'OPEN' as const })),
    ...Array.from({ length: counts.medium }, () => ({ severity: 'MEDIUM', status: 'OPEN' as const })),
    ...Array.from({ length: counts.low }, () => ({ severity: 'LOW', status: 'OPEN' as const })),
  ];
  return computeQualityScore(findings).score;
}

export function trendOf(history: HistoryPoint[]): { direction: 'up' | 'down' | 'flat' | 'none'; delta: number } {
  if (history.length < 2) return { direction: 'none', delta: 0 };
  const delta = history[history.length - 1].score - history[history.length - 2].score;
  return { direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', delta };
}

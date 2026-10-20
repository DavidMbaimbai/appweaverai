import { prisma } from '@/lib/prisma';

import { evaluateApprovalGate, listApprovals, type ApprovalGate } from './approvals';
import { listDiagnoses, type StoredDiagnosis } from './diagnosis';
import { getLatestRegression, type StoredRegression } from './regression';
import { canSchedule, getSchedule, ownerTier, type StoredSchedule } from './schedule';
import { bucketByAge, computeQualityScore, scoreFromCounts, topFiles, trendOf, type HistoryPoint } from './score';
import { getLatestScan, type StoredScan } from './service';

export type QualityDashboard = {
  scan: StoredScan | null;
  score: ReturnType<typeof computeQualityScore> | null;
  severityCounts: Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', number>;
  ageBuckets: ReturnType<typeof bucketByAge>;
  topFiles: ReturnType<typeof topFiles>;
  history: HistoryPoint[];
  trend: ReturnType<typeof trendOf>;
  schedule: StoredSchedule | null;
  canSchedule: boolean;
  regression: StoredRegression | null;
  approvalGate: ApprovalGate;
  approvals: Awaited<ReturnType<typeof listApprovals>>;
  diagnoses: StoredDiagnosis[];
};

/** Fleet-wide numbers for the admin page: schedules, approvals, regression results and the score of each project's latest scan. */
export async function getAdminQualityExtras(latest: Array<{ projectId: string; criticalCount: number; highCount: number; mediumCount: number; lowCount: number }>) {
  const [schedulesOn, schedulesTotal, pendingApprovals, regressionRuns] = await Promise.all([
    prisma.scanSchedule.count({ where: { enabled: true } }),
    prisma.scanSchedule.count(),
    prisma.changeApproval.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } }),
    prisma.scanRun.findMany({
      where: { kind: 'REGRESSION' },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { projectId: true, regressionStatus: true },
    }),
  ]);
  const latestRegression = new Map<string, string | null>();
  for (const run of regressionRuns) if (!latestRegression.has(run.projectId)) latestRegression.set(run.projectId, run.regressionStatus);
  const scores = latest.map((r) =>
    scoreFromCounts({ critical: r.criticalCount, high: r.highCount, medium: r.mediumCount, low: r.lowCount }),
  );
  return {
    schedulesOn,
    schedulesTotal,
    pendingApprovals,
    regressionFailed: [...latestRegression.values()].filter((s) => s === 'FAILED').length,
    regressionNotRun: [...latestRegression.values()].filter((s) => s === 'NOT_RUN').length,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    severityTotals: {
      CRITICAL: latest.reduce((s, r) => s + r.criticalCount, 0),
      HIGH: latest.reduce((s, r) => s + r.highCount, 0),
      MEDIUM: latest.reduce((s, r) => s + r.mediumCount, 0),
      LOW: latest.reduce((s, r) => s + r.lowCount, 0),
    },
  };
}

export async function loadQualityDashboard(projectId: string): Promise<QualityDashboard> {
  const [scan, runs, schedule, tier, regression, approvalGate, approvals, diagnoses] = await Promise.all([
    getLatestScan(projectId),
    prisma.scanRun.findMany({ where: { projectId, kind: 'SCAN' }, orderBy: { createdAt: 'desc' }, take: 20 }),
    getSchedule(projectId),
    ownerTier(projectId),
    getLatestRegression(projectId),
    evaluateApprovalGate(projectId),
    listApprovals(projectId),
    listDiagnoses(projectId),
  ]);

  const findings = scan?.findings ?? [];
  const open = findings.filter((f) => f.status === 'OPEN');
  const count = (severity: string) => open.filter((f) => f.severity === severity).length;

  const history: HistoryPoint[] = runs
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      critical: r.criticalCount,
      high: r.highCount,
      medium: r.mediumCount,
      low: r.lowCount,
      score: scoreFromCounts({ critical: r.criticalCount, high: r.highCount, medium: r.mediumCount, low: r.lowCount }),
    }))
    .reverse();

  return {
    scan,
    score: scan ? computeQualityScore(findings) : null,
    severityCounts: { CRITICAL: count('CRITICAL'), HIGH: count('HIGH'), MEDIUM: count('MEDIUM'), LOW: count('LOW') },
    ageBuckets: bucketByAge(findings),
    topFiles: topFiles(findings),
    history,
    trend: trendOf(history),
    schedule,
    canSchedule: canSchedule(tier),
    regression,
    approvalGate,
    approvals,
    diagnoses,
  };
}

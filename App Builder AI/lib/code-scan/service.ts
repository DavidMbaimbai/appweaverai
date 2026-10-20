import { prisma } from '@/lib/prisma';

import { auditUserDecision } from './audit';
import { loadScanFiles, type ScanSource } from './files';
import type { OsvOptions } from './osv';
import { countBySeverity, decideScanGate, scanFiles, type GateFinding } from './scan';
import type { DependencyStatus, FindingStatus, ScanFile, ScannedFinding } from './types';

export const MIN_ACK_REASON_LENGTH = 10;
export const MAX_ACK_REASON_LENGTH = 500;

export type ScanTrigger = 'MANUAL' | 'PUBLISH' | 'READINESS' | 'ADMIN' | 'SCHEDULED';

export type StoredFinding = {
  id: string;
  rule: string;
  category: string;
  severity: string;
  file: string;
  line: number | null;
  title: string;
  message: string;
  snippet: string | null;
  status: FindingStatus;
  ackReason: string | null;
  ackAt: string | null;
  firstSeenAt: string | null;
  fixProposal: string | null;
};

export type StoredScan = {
  id: string;
  trigger: string;
  source: string;
  createdAt: string;
  filesScanned: number;
  counts: { critical: number; high: number; medium: number; low: number };
  depStatus: DependencyStatus;
  depDetail: string | null;
  findings: StoredFinding[];
};

type RunRow = {
  id: string;
  trigger: string;
  source: string;
  createdAt: Date;
  filesScanned: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  depStatus: string;
  depDetail: string | null;
};

type FindingRow = {
  id: string;
  rule: string;
  category: string;
  severity: string;
  file: string;
  line: number | null;
  title: string;
  message: string;
  snippet: string | null;
  status: string;
  ackReason: string | null;
  ackAt: Date | null;
  firstSeenAt?: Date | null;
  createdAt?: Date;
  fixProposal: string | null;
};

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function toStoredScan(run: RunRow, findings: FindingRow[]): StoredScan {
  return {
    id: run.id,
    trigger: run.trigger,
    source: run.source,
    createdAt: run.createdAt.toISOString(),
    filesScanned: run.filesScanned,
    counts: { critical: run.criticalCount, high: run.highCount, medium: run.mediumCount, low: run.lowCount },
    depStatus: run.depStatus as DependencyStatus,
    depDetail: run.depDetail,
    findings: findings
      .map((f) => ({
        id: f.id,
        rule: f.rule,
        category: f.category,
        severity: f.severity,
        file: f.file,
        line: f.line,
        title: f.title,
        message: f.message,
        snippet: f.snippet,
        status: f.status as FindingStatus,
        ackReason: f.ackReason,
        ackAt: f.ackAt?.toISOString() ?? null,
        firstSeenAt: (f.firstSeenAt ?? f.createdAt ?? null)?.toISOString() ?? null,
        fixProposal: f.fixProposal,
      }))
      .sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          a.file.localeCompare(b.file) ||
          (a.line ?? 0) - (b.line ?? 0),
      ),
  };
}

export type RunScanInput = {
  projectId: string;
  userId?: string | null;
  trigger: ScanTrigger;
  source?: ScanSource;
  /** Test seam: scan these files instead of loading the project's. */
  files?: ScanFile[];
  osv?: OsvOptions;
  skipDependencies?: boolean;
};

/**
 * Scans the project, stores a ScanRun with its findings, and carries over acknowledgements
 * for findings that are still present. Findings from the previous run that are gone become FIXED.
 */
export async function runCodeScan(input: RunScanInput): Promise<StoredScan> {
  const source = input.source ?? 'WORKING';
  const loaded = input.files ? { files: input.files, source } : await loadScanFiles(input.projectId, source);
  const output = await scanFiles(loaded.files, { osv: input.osv, skipDependencies: input.skipDependencies });

  const previous = await prisma.scanRun.findFirst({
    where: { projectId: input.projectId, kind: 'SCAN' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const previousFindings = previous
    ? await prisma.scanFinding.findMany({
        where: { runId: previous.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      })
    : [];
  const acknowledged = new Map(
    (
      await prisma.scanFinding.findMany({
        where: {
          projectId: input.projectId,
          status: 'ACKNOWLEDGED',
          fingerprint: { in: output.findings.map((f) => f.fingerprint) },
        },
        orderBy: { ackAt: 'asc' },
      })
    ).map((f) => [f.fingerprint, f]),
  );

  // When OSV was unreachable we learned nothing new about dependencies, so earlier advisories stay visible instead of vanishing.
  const carried: ScannedFinding[] = [];
  if (output.dependencies.status === 'UNAVAILABLE') {
    const present = new Set(output.findings.map((f) => f.fingerprint));
    for (const f of previousFindings) {
      if (f.category !== 'DEPENDENCY' || present.has(f.fingerprint)) continue;
      carried.push({
        rule: f.rule,
        category: 'DEPENDENCY',
        severity: f.severity as ScannedFinding['severity'],
        file: f.file,
        line: f.line,
        title: f.title,
        message: f.message,
        snippet: f.snippet ?? undefined,
        fingerprint: f.fingerprint,
      });
    }
  }
  const firstSeen = new Map(previousFindings.map((f) => [f.fingerprint, f.firstSeenAt ?? f.createdAt]));
  const all = [...output.findings, ...carried];
  const counts = countBySeverity(all);

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.scanRun.create({
      data: {
        projectId: input.projectId,
        kind: 'SCAN',
        triggeredById: input.userId ?? null,
        trigger: input.trigger,
        source: loaded.source,
        filesScanned: output.filesScanned,
        criticalCount: counts.critical,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        depStatus: output.dependencies.status,
        depDetail: output.dependencies.detail,
      },
    });
    if (all.length > 0) {
      await tx.scanFinding.createMany({
        data: all.map((f) => {
          const ack = acknowledged.get(f.fingerprint);
          return {
            runId: created.id,
            projectId: input.projectId,
            fingerprint: f.fingerprint,
            rule: f.rule,
            category: f.category,
            severity: f.severity,
            file: f.file,
            line: f.line,
            title: f.title,
            message: f.message,
            snippet: f.snippet ?? null,
            status: ack ? 'ACKNOWLEDGED' : 'OPEN',
            ackReason: ack?.ackReason ?? null,
            ackById: ack?.ackById ?? null,
            ackAt: ack?.ackAt ?? null,
            fixProposal: ack?.fixProposal ?? null,
            fixProposedAt: ack?.fixProposedAt ?? null,
            firstSeenAt: firstSeen.get(f.fingerprint) ?? ack?.firstSeenAt ?? ack?.createdAt ?? new Date(),
          };
        }),
      });
    }
    const stillPresent = new Set(all.map((f) => f.fingerprint));
    const gone = previousFindings.filter((f) => !stillPresent.has(f.fingerprint)).map((f) => f.id);
    if (gone.length > 0) {
      await tx.scanFinding.updateMany({ where: { id: { in: gone } }, data: { status: 'FIXED' } });
    }
    return created;
  });

  const rows = await prisma.scanFinding.findMany({ where: { runId: run.id } });
  return toStoredScan(run, rows);
}

export async function getLatestScan(projectId: string): Promise<StoredScan | null> {
  const run = await prisma.scanRun.findFirst({ where: { projectId, kind: 'SCAN' }, orderBy: { createdAt: 'desc' } });
  if (!run) return null;
  const rows = await prisma.scanFinding.findMany({ where: { runId: run.id } });
  return toStoredScan(run, rows);
}

export type ScanGate = {
  blocked: boolean;
  blocking: GateFinding[];
  runId: string;
  depStatus: DependencyStatus;
  depDetail: string | null;
};

/** Publish gate: a fresh scan, then OPEN HIGH/CRITICAL findings block. Acknowledged findings do not. */
export async function evaluateScanGate(
  projectId: string,
  source: ScanSource,
  userId?: string | null,
): Promise<ScanGate> {
  const scan = await runCodeScan({ projectId, userId, trigger: 'PUBLISH', source });
  const decision = decideScanGate(scan.findings);
  return { ...decision, runId: scan.id, depStatus: scan.depStatus, depDetail: scan.depDetail };
}

export type AckResult = { ok: true } | { ok: false; error: string };

export function validateAckReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < MIN_ACK_REASON_LENGTH) {
    return `Explain why this is acceptable (at least ${MIN_ACK_REASON_LENGTH} characters).`;
  }
  if (trimmed.length > MAX_ACK_REASON_LENGTH) return `Keep the reason under ${MAX_ACK_REASON_LENGTH} characters.`;
  return null;
}

export async function acknowledgeFinding(input: {
  projectId: string;
  userId: string;
  findingId: string;
  reason: string;
}): Promise<AckResult> {
  const invalid = validateAckReason(input.reason);
  if (invalid) return { ok: false, error: invalid };

  const finding = await prisma.scanFinding.findFirst({ where: { id: input.findingId, projectId: input.projectId } });
  if (!finding) return { ok: false, error: 'Finding not found.' };

  const latest = await prisma.scanRun.findFirst({
    where: { projectId: input.projectId, kind: 'SCAN' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (latest?.id !== finding.runId) return { ok: false, error: 'A newer scan exists. Re-run the scan first.' };
  if (finding.status !== 'OPEN') return { ok: false, error: 'This finding is not open.' };

  const reason = input.reason.trim();
  await prisma.scanFinding.update({
    where: { id: finding.id },
    data: { status: 'ACKNOWLEDGED', ackReason: reason, ackById: input.userId, ackAt: new Date() },
  });
  await auditUserDecision({
    userId: input.userId,
    action: 'code_scan.finding_acknowledged',
    targetType: 'Project',
    targetId: input.projectId,
    reason,
    after: {
      findingId: finding.id,
      rule: finding.rule,
      severity: finding.severity,
      file: finding.file,
      line: finding.line,
      reason,
    },
  });
  return { ok: true };
}

/** Whether `userId` may acknowledge findings: the workspace owner or the project's creator. */
export async function isProjectOwner(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, OR: [{ createdById: userId }, { workspace: { ownerId: userId } }] },
    select: { id: true },
  });
  return Boolean(project);
}

/** Latest run per project, newest first. */
export async function listLatestScansPerProject(limit = 100) {
  return prisma.scanRun.findMany({
    where: { kind: 'SCAN' },
    distinct: ['projectId'],
    orderBy: [{ projectId: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    include: { project: { select: { id: true, name: true, slug: true, workspace: { select: { slug: true } } } } },
  });
}

export async function getAdminOverview() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const latest = await prisma.scanRun.findMany({
    where: { kind: 'SCAN' },
    distinct: ['projectId'],
    orderBy: [{ projectId: 'asc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  const latestIds = latest.map((r) => r.id);
  const [runs, openBlocking, acknowledgedBlocking, byRule] = await Promise.all([
    prisma.scanRun.count({ where: { kind: 'SCAN', createdAt: { gte: since } } }),
    prisma.scanFinding.count({
      where: { runId: { in: latestIds }, status: 'OPEN', severity: { in: ['CRITICAL', 'HIGH'] } },
    }),
    prisma.scanFinding.count({
      where: { runId: { in: latestIds }, status: 'ACKNOWLEDGED', severity: { in: ['CRITICAL', 'HIGH'] } },
    }),
    prisma.scanFinding.groupBy({
      by: ['rule'],
      where: { runId: { in: latestIds } },
      _count: { _all: true },
      orderBy: { _count: { rule: 'desc' } },
      take: 10,
    }),
  ]);
  return {
    runs,
    projectsScanned: latestIds.length,
    openBlocking,
    acknowledgedBlocking,
    topRules: byRule.map((r) => ({ rule: r.rule, count: r._count._all })),
  };
}

import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';

import { auditUserDecision } from './audit';
import { getLatestRegression } from './regression';
import { isProjectOwner, MIN_ACK_REASON_LENGTH, MAX_ACK_REASON_LENGTH, getLatestScan } from './service';

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type RiskKind = 'HIGH_FINDINGS' | 'REGRESSION_FAILED' | 'ENV_CHANGE' | 'DOMAIN_CHANGE';
export type Risk = { kind: RiskKind; summary: string };

export type RiskInputs = {
  acknowledgedHigh: Array<{ rule: string; file: string; severity: string }>;
  regressionStatus: 'PASSED' | 'FAILED' | 'NOT_RUN' | null;
  changedProductionEnvKeys: string[];
  changedDomain: string | null;
};

/** Pure: which risky production changes are present. Env values are never included, only key names. */
export function computeRisks(input: RiskInputs): Risk[] {
  const risks: Risk[] = [];
  if (input.acknowledgedHigh.length > 0) {
    const sample = input.acknowledgedHigh.slice(0, 3).map((f) => `${f.rule} in ${f.file}`).join('; ');
    risks.push({
      kind: 'HIGH_FINDINGS',
      summary: `${input.acknowledgedHigh.length} acknowledged high/critical security finding(s): ${sample}`,
    });
  }
  if (input.regressionStatus === 'FAILED') {
    risks.push({ kind: 'REGRESSION_FAILED', summary: 'The latest regression check (tests/build) failed.' });
  }
  if (input.changedProductionEnvKeys.length > 0) {
    risks.push({
      kind: 'ENV_CHANGE',
      summary: `Production environment variables changed since the last production deploy: ${[...input.changedProductionEnvKeys].sort().join(', ')}`,
    });
  }
  if (input.changedDomain) {
    risks.push({ kind: 'DOMAIN_CHANGE', summary: `Custom domain ${input.changedDomain} changed since the last production deploy.` });
  }
  return risks;
}

/** Stable hash: an approval only covers the exact risk set it was requested for. */
export function riskDigest(risks: Risk[]): string {
  const canonical = [...risks].map((r) => `${r.kind}:${r.summary}`).sort().join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export type ApprovalState = 'APPROVED' | 'PENDING' | 'REJECTED';

export type ApprovalGate = {
  required: boolean;
  risks: Risk[];
  digest: string | null;
  /** Present when required: whether a usable approval exists. */
  state: ApprovalState | 'NONE' | null;
  approvalId: string | null;
};

export type ApprovalRow = { id: string; digest: string; status: string; expiresAt: Date };

/** Pure: decides from the risks and the approvals on file. */
export function decideApprovalGate(risks: Risk[], approvals: ApprovalRow[], now = new Date()): ApprovalGate {
  if (risks.length === 0) return { required: false, risks, digest: null, state: null, approvalId: null };
  const digest = riskDigest(risks);
  const matching = approvals.filter((a) => a.digest === digest && a.expiresAt.getTime() > now.getTime());
  const approved = matching.find((a) => a.status === 'APPROVED');
  if (approved) return { required: true, risks, digest, state: 'APPROVED', approvalId: approved.id };
  const pending = matching.find((a) => a.status === 'PENDING');
  if (pending) return { required: true, risks, digest, state: 'PENDING', approvalId: pending.id };
  const rejected = matching.find((a) => a.status === 'REJECTED');
  if (rejected) return { required: true, risks, digest, state: 'REJECTED', approvalId: rejected.id };
  return { required: true, risks, digest, state: 'NONE', approvalId: null };
}

export function validateDecisionReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < MIN_ACK_REASON_LENGTH) return `Give a reason of at least ${MIN_ACK_REASON_LENGTH} characters.`;
  if (trimmed.length > MAX_ACK_REASON_LENGTH) return `Keep the reason under ${MAX_ACK_REASON_LENGTH} characters.`;
  return null;
}

/** Reads the project's current risk inputs. Env/domain changes are measured against the latest production deploy. */
export async function collectRiskInputs(projectId: string): Promise<RiskInputs> {
  const [scan, regression, lastProd] = await Promise.all([
    getLatestScan(projectId),
    getLatestRegression(projectId),
    prisma.deployment.findFirst({
      where: { projectId, environment: 'PRODUCTION' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const acknowledgedHigh = (scan?.findings ?? [])
    .filter((f) => f.status === 'ACKNOWLEDGED' && (f.severity === 'HIGH' || f.severity === 'CRITICAL'))
    .map((f) => ({ rule: f.rule, file: f.file, severity: f.severity }));

  let changedProductionEnvKeys: string[] = [];
  let changedDomain: string | null = null;
  if (lastProd) {
    const [secrets, domain] = await Promise.all([
      prisma.projectSecret.findMany({
        where: { projectId, environment: 'PRODUCTION', updatedAt: { gt: lastProd.createdAt } },
        select: { key: true },
      }),
      prisma.projectCustomDomain.findUnique({ where: { projectId }, select: { domain: true, updatedAt: true } }),
    ]);
    changedProductionEnvKeys = secrets.map((s) => s.key);
    if (domain && domain.updatedAt > lastProd.createdAt) changedDomain = domain.domain;
  }

  return {
    acknowledgedHigh,
    regressionStatus: regression?.status ?? null,
    changedProductionEnvKeys,
    changedDomain,
  };
}

export async function evaluateApprovalGate(projectId: string, now = new Date()): Promise<ApprovalGate> {
  const risks = computeRisks(await collectRiskInputs(projectId));
  if (risks.length === 0) return decideApprovalGate(risks, [], now);
  const approvals = await prisma.changeApproval.findMany({
    where: { projectId, digest: riskDigest(risks), status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, digest: true, status: true, expiresAt: true },
  });
  return decideApprovalGate(risks, approvals, now);
}

export function formatApprovalGateError(gate: ApprovalGate): string {
  const list = gate.risks.map((r) => `• ${r.summary}`).join('\n');
  const next =
    gate.state === 'PENDING'
      ? 'An approval request is waiting for the project owner.'
      : gate.state === 'REJECTED'
        ? 'The owner rejected this change. Resolve the risks or request approval again.'
        : 'Request approval from the project owner.';
  return `This production change needs explicit owner approval.\n${list}\n${next}`;
}

export type ApprovalResult = { ok: true; approvalId: string } | { ok: false; error: string };

/** Anyone who can edit the project may ask; only the owner can decide. Reuses a live pending request. */
export async function requestApproval(input: { projectId: string; userId: string }): Promise<ApprovalResult> {
  const gate = await evaluateApprovalGate(input.projectId);
  if (!gate.required || !gate.digest) return { ok: false, error: 'No approval is needed for this project right now.' };
  if (gate.approvalId && gate.state !== 'REJECTED') return { ok: true, approvalId: gate.approvalId };

  const created = await prisma.changeApproval.create({
    data: {
      projectId: input.projectId,
      digest: gate.digest,
      risks: gate.risks,
      requestedById: input.userId,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
  await auditUserDecision({
    userId: input.userId,
    action: 'code_scan.approval_requested',
    targetType: 'Project',
    targetId: input.projectId,
    after: { approvalId: created.id, risks: gate.risks },
  });
  return { ok: true, approvalId: created.id };
}

/** Atomic PENDING -> APPROVED/REJECTED claim, like the agent approval flow. Owner only, reason required. */
export async function decideApproval(input: {
  projectId: string;
  approvalId: string;
  userId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}): Promise<ApprovalResult> {
  const invalid = validateDecisionReason(input.reason);
  if (invalid) return { ok: false, error: invalid };
  if (!(await isProjectOwner(input.projectId, input.userId))) {
    return { ok: false, error: 'Only the project owner can approve or reject production changes.' };
  }
  const reason = input.reason.trim();
  const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const claimed = await prisma.changeApproval.updateMany({
    where: { id: input.approvalId, projectId: input.projectId, status: 'PENDING', expiresAt: { gt: new Date() } },
    data: { status, decidedById: input.userId, decisionReason: reason, decidedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: 'This request was already decided or has expired.' };

  await auditUserDecision({
    userId: input.userId,
    action: input.decision === 'APPROVE' ? 'code_scan.approval_approved' : 'code_scan.approval_rejected',
    targetType: 'Project',
    targetId: input.projectId,
    reason,
    after: { approvalId: input.approvalId, status },
  });
  return { ok: true, approvalId: input.approvalId };
}

/** Marks the matching approved request as used so one approval covers one production publish. */
export async function consumeApproval(projectId: string, userId: string | null) {
  const approved = await prisma.changeApproval.findMany({
    where: { projectId, status: 'APPROVED' },
    select: { id: true, risks: true },
  });
  for (const approval of approved) {
    const claimed = await prisma.changeApproval.updateMany({
      where: { id: approval.id, status: 'APPROVED' },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
    if (claimed.count > 0 && userId) {
      await auditUserDecision({
        userId,
        action: 'code_scan.approval_consumed',
        targetType: 'Project',
        targetId: projectId,
        after: { approvalId: approval.id, risks: approval.risks },
      });
    }
  }
}

export async function listApprovals(projectId: string, limit = 10) {
  const rows = await prisma.changeApproval.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    risks: (Array.isArray(r.risks) ? r.risks : []) as Risk[],
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
  }));
}

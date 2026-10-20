import { describe, expect, it } from 'vitest';

import { consumeApproval, decideApproval, evaluateApprovalGate, requestApproval } from '@/lib/code-scan/approvals';
import { getAdminQualityExtras } from '@/lib/code-scan/dashboard';
import { getLatestRegression, runRegressionCheck, type SandboxRunner } from '@/lib/code-scan/regression';
import { runDueScans, setSchedule } from '@/lib/code-scan/schedule';
import { getLatestScan, runCodeScan } from '@/lib/code-scan/service';
import type { ScanFile } from '@/lib/code-scan/types';

import { makeProjectFor, makeUser, prisma } from './db';

const STRIPE_LIVE = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('_');
const leaky: ScanFile = { path: 'lib/a.ts', size: 10, content: `export const k = "${STRIPE_LIVE}";\n` };
const artifacts = [{ slug: 'web', packageJson: JSON.stringify({ scripts: { test: 'vitest run' } }) }];

const failing: SandboxRunner = async (_p, _a, _c, onData) => {
  onData('FAIL a.test.ts\nTOKEN=abcdefghijklmnop123456\n', 'stdout');
  return { exitCode: 1, timedOut: false };
};
const passing: SandboxRunner = async () => ({ exitCode: 0, timedOut: false });
const noDocker: SandboxRunner = async () => ({ exitCode: null, timedOut: false, error: 'docker not found' });

async function setup(plan?: string) {
  const owner = await makeUser({ plan });
  if (plan) await prisma.user.update({ where: { id: owner.id }, data: { subscriptionStatus: 'active' } });
  const { project } = await makeProjectFor(owner);
  return { owner, project };
}

describe('regression result persistence', () => {
  it('records PASSED/FAILED from the exit code, redacts output, and never fakes a pass when the sandbox is missing', async () => {
    const { owner, project } = await setup();

    const failed = await runRegressionCheck({ projectId: project.id, userId: owner.id, runner: failing, artifacts });
    expect(failed.status).toBe('FAILED');
    expect(failed.output).not.toContain('abcdefghijklmnop123456');

    expect((await runRegressionCheck({ projectId: project.id, runner: noDocker, artifacts })).status).toBe('NOT_RUN');
    expect((await runRegressionCheck({ projectId: project.id, runner: passing, artifacts: [] })).status).toBe('NOT_RUN');
    expect((await getLatestRegression(project.id))?.status).toBe('NOT_RUN');
    expect((await runRegressionCheck({ projectId: project.id, runner: passing, artifacts })).status).toBe('PASSED');

    const rows = await prisma.scanRun.findMany({ where: { projectId: project.id, kind: 'REGRESSION' } });
    expect(rows).toHaveLength(4);
    // Regression rows must not be mistaken for a security scan.
    expect(await getLatestScan(project.id)).toBeNull();
  });
});

describe('approval gate for risky production changes', () => {
  it('needs an owner decision with a reason, is bound to the risk set, single-use, and audited', async () => {
    const { owner, project } = await setup();
    const editor = await makeUser();

    expect((await evaluateApprovalGate(project.id)).required).toBe(false);
    await runRegressionCheck({ projectId: project.id, runner: failing, artifacts });
    const gate = await evaluateApprovalGate(project.id);
    expect(gate).toMatchObject({ required: true, state: 'NONE' });

    const requested = await requestApproval({ projectId: project.id, userId: editor.id });
    expect(requested.ok).toBe(true);
    const approvalId = (requested as { approvalId: string }).approvalId;
    // Asking again reuses the pending request.
    expect(await requestApproval({ projectId: project.id, userId: editor.id })).toEqual({ ok: true, approvalId });

    const base = { projectId: project.id, approvalId, decision: 'APPROVE' as const };
    expect(await decideApproval({ ...base, userId: editor.id, reason: 'I would like to ship this' })).toMatchObject({ ok: false });
    expect(await decideApproval({ ...base, userId: owner.id, reason: 'short' })).toMatchObject({ ok: false });
    expect((await evaluateApprovalGate(project.id)).state).toBe('PENDING');

    expect(await decideApproval({ ...base, userId: owner.id, reason: 'Flaky test, verified manually' })).toMatchObject({ ok: true });
    expect(await decideApproval({ ...base, userId: owner.id, reason: 'Deciding a second time' })).toMatchObject({ ok: false });
    expect((await evaluateApprovalGate(project.id)).state).toBe('APPROVED');

    // A new production env change after the approval changes the risk set, so the old approval no longer applies.
    await prisma.deployment.create({
      data: { projectId: project.id, version: 1, domain: 'x.example.test', createdById: owner.id, environment: 'PRODUCTION', createdAt: new Date(Date.now() - 3_600_000) },
    });
    await prisma.projectSecret.create({ data: { projectId: project.id, key: 'API_URL', value: 'enc', environment: 'PRODUCTION' } });
    const changed = await evaluateApprovalGate(project.id);
    expect(changed.risks.map((r) => r.kind)).toContain('ENV_CHANGE');
    expect(JSON.stringify(changed.risks)).not.toContain('enc"');
    expect(changed.state).toBe('NONE');

    await consumeApproval(project.id, owner.id);
    expect((await prisma.changeApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('CONSUMED');

    const actions = (await prisma.adminAuditLog.findMany({ where: { targetId: project.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['code_scan.approval_requested', 'code_scan.approval_approved', 'code_scan.approval_consumed']));
  });

  it('requires approval when an acknowledged HIGH finding is present', async () => {
    const { owner, project } = await setup();
    const first = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });
    await prisma.scanFinding.update({ where: { id: first.findings[0].id }, data: { status: 'ACKNOWLEDGED', ackReason: 'accepted for demo', ackById: owner.id, ackAt: new Date() } });
    const gate = await evaluateApprovalGate(project.id);
    expect(gate.risks.map((r) => r.kind)).toContain('HIGH_FINDINGS');
  });
});

describe('scheduled scans and first-seen tracking', () => {
  it('runs due scans for Pro owners only, and skips (with a reason) after a downgrade', async () => {
    const pro = await setup('pro');
    const free = await setup();
    const past = new Date(Date.now() - 1000);
    await prisma.scanSchedule.createMany({
      data: [
        { projectId: pro.project.id, frequency: 'DAILY', nextRunAt: past },
        { projectId: free.project.id, frequency: 'WEEKLY', nextRunAt: past },
      ],
    });

    const summary = await runDueScans(new Date(), 10);
    expect(summary).toMatchObject({ ran: 1, skipped: 1, failed: 0 });
    const runs = await prisma.scanRun.findMany({ where: { projectId: pro.project.id } });
    expect(runs.map((r) => r.trigger)).toEqual(['SCHEDULED']);
    const skipped = await prisma.scanSchedule.findUniqueOrThrow({ where: { projectId: free.project.id } });
    expect(skipped.lastError).toMatch(/plan/i);
    expect((await prisma.scanSchedule.findUniqueOrThrow({ where: { projectId: pro.project.id } })).nextRunAt.getTime()).toBeGreaterThan(Date.now());

    expect(await setSchedule({ projectId: free.project.id, userId: free.owner.id, enabled: true, frequency: 'DAILY' })).toMatchObject({ ok: false });
    expect(await setSchedule({ projectId: pro.project.id, userId: pro.owner.id, enabled: true, frequency: 'WEEKLY' })).toMatchObject({ ok: true });
  });

  it('keeps firstSeenAt across rescans so finding age is real', async () => {
    const { owner, project } = await setup();
    const first = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });
    const old = new Date(Date.now() - 10 * 86_400_000);
    await prisma.scanFinding.update({ where: { id: first.findings[0].id }, data: { firstSeenAt: old } });
    const second = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });
    expect(new Date(second.findings[0].firstSeenAt!).getTime()).toBe(old.getTime());
  });

  it('admin extras summarise averages, schedules and pending approvals', async () => {
    const { project } = await setup();
    const extras = await getAdminQualityExtras([{ projectId: project.id, criticalCount: 1, highCount: 0, mediumCount: 0, lowCount: 0 }]);
    expect(extras).toMatchObject({ averageScore: 75, pendingApprovals: 0, schedulesOn: 0 });
  });
});

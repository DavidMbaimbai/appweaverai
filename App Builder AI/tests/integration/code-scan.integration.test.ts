import { describe, expect, it } from 'vitest';

import { decideScanGate } from '@/lib/code-scan/scan';
import { acknowledgeFinding, getLatestScan, isProjectOwner, runCodeScan } from '@/lib/code-scan/service';
import type { ScanFile } from '@/lib/code-scan/types';

import { makeProjectFor, makeUser, prisma } from './db';

const STRIPE_LIVE = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('_');
const file = (path: string, content: string): ScanFile => ({ path, size: content.length, content });
const leaky = file('lib/billing.ts', `export const key = "${STRIPE_LIVE}";\n`);
const clean = file('lib/billing.ts', `export const key = process.env.STRIPE_SECRET_KEY;\n`);
const pkg = file('package.json', JSON.stringify({ dependencies: { lodash: '4.17.15' } }));

const down = { fetchImpl: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch };

async function setup() {
  const owner = await makeUser();
  const { project } = await makeProjectFor(owner);
  return { owner, project };
}

describe('code scan persistence and gate', () => {
  it('persists a run with findings and counts, and blocks on open secrets', async () => {
    const { owner, project } = await setup();
    const scan = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });

    const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } });
    expect(run).toMatchObject({ projectId: project.id, trigger: 'MANUAL', criticalCount: 1, filesScanned: 1 });
    const rows = await prisma.scanFinding.findMany({ where: { runId: run.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rule: 'secret/stripe-live-key', severity: 'CRITICAL', status: 'OPEN', file: 'lib/billing.ts', line: 1 });
    expect(rows[0].snippet ?? '').not.toContain(STRIPE_LIVE);
    expect(decideScanGate((await getLatestScan(project.id))!.findings).blocked).toBe(true);
  });

  it('acknowledgement needs a reason, is audited, unblocks, and carries over to the next scan', async () => {
    const { owner, project } = await setup();
    const first = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });
    const findingId = first.findings[0].id;

    expect(await acknowledgeFinding({ projectId: project.id, userId: owner.id, findingId, reason: 'short' })).toMatchObject({ ok: false });
    expect(await isProjectOwner(project.id, owner.id)).toBe(true);
    expect(await isProjectOwner(project.id, (await makeUser()).id)).toBe(false);
    expect(
      await acknowledgeFinding({ projectId: project.id, userId: owner.id, findingId, reason: 'Revoked test key kept for a demo' }),
    ).toEqual({ ok: true });

    const audit = await prisma.adminAuditLog.findMany({ where: { action: 'code_scan.finding_acknowledged' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].after)).toContain('Revoked test key kept for a demo');

    const second = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'PUBLISH', files: [leaky], skipDependencies: true });
    expect(second.findings[0]).toMatchObject({ status: 'ACKNOWLEDGED', ackReason: 'Revoked test key kept for a demo' });
    expect(decideScanGate(second.findings).blocked).toBe(false);

    // The first run is no longer the latest, so its findings can't be acknowledged again.
    expect(await acknowledgeFinding({ projectId: project.id, userId: owner.id, findingId, reason: 'Trying an old run again' })).toMatchObject({ ok: false });
  });

  it('marks vanished findings FIXED and re-opens nothing', async () => {
    const { owner, project } = await setup();
    await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });
    const fixed = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [clean], skipDependencies: true });

    expect(fixed.findings.filter((f) => f.status === 'OPEN')).toEqual([]);
    expect(decideScanGate(fixed.findings).blocked).toBe(false);
    const previous = await prisma.scanFinding.findMany({ where: { projectId: project.id, rule: 'secret/stripe-live-key' } });
    expect(previous.every((f) => f.status === 'FIXED' || f.runId === fixed.id)).toBe(true);
  });

  it('records dependency check as UNAVAILABLE during an OSV outage instead of a clean result', async () => {
    const { owner, project } = await setup();
    const scan = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'PUBLISH', files: [clean, pkg], osv: down });
    expect(scan.depStatus).toBe('UNAVAILABLE');
    expect(scan.depDetail).toMatch(/NOT checked/);
    expect(scan.findings.filter((f) => f.category === 'DEPENDENCY')).toEqual([]);
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } })).depStatus).toBe('UNAVAILABLE');
  });

  it('carries earlier dependency findings forward when OSV is unavailable', async () => {
    const { owner, project } = await setup();
    const osvOk = {
      fetchImpl: (async (url: string | URL | Request) =>
        String(url).endsWith('/querybatch')
          ? new Response(JSON.stringify({ results: [{ vulns: [{ id: 'GHSA-test-0001' }] }] }), { status: 200 })
          : new Response(JSON.stringify({ id: 'GHSA-test-0001', database_specific: { severity: 'CRITICAL' } }), { status: 200 })) as unknown as typeof fetch,
      cache: { lookups: new Map(), details: new Map() },
    };
    const first = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [clean, pkg], osv: osvOk });
    expect(first.findings.some((f) => f.category === 'DEPENDENCY' && f.severity === 'CRITICAL')).toBe(true);

    const second = await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'PUBLISH', files: [clean, pkg], osv: down });
    expect(second.depStatus).toBe('UNAVAILABLE');
    expect(decideScanGate(second.findings).blocked).toBe(true);
  });

  it('cascades scan data when the project is deleted', async () => {
    const { owner, project } = await setup();
    await runCodeScan({ projectId: project.id, userId: owner.id, trigger: 'MANUAL', files: [leaky], skipDependencies: true });
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.scanRun.count()).toBe(0);
    expect(await prisma.scanFinding.count()).toBe(0);
  });
});

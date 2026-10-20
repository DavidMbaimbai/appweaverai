import { describe, expect, it } from 'vitest';

import { GET, POST } from '@/app/api/cron/backups/route';
import { getBackupHealth, listBackupRuns } from '@/lib/backups';

import { prisma } from './db';

const auth = { authorization: 'Bearer integration-cron-secret' };

function report(body: unknown, headers: Record<string, string> = auth) {
  return POST(new Request('http://localhost/api/cron/backups', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
}

describe('backup reporting and watchdog', () => {
  it('rejects unauthenticated and malformed reports', async () => {
    expect((await report({ status: 'SUCCESS' }, {})).status).toBe(401);
    expect((await report({ status: 'NOPE' })).status).toBe(400);
    expect(await prisma.backupRun.count()).toBe(0);
  });

  it('records runs, reports health, and turns a failure into an issue', async () => {
    const now = new Date();
    const times = { startedAt: new Date(now.getTime() - 60_000).toISOString(), finishedAt: now.toISOString() };
    expect((await report({ status: 'SUCCESS', location: 's3://b/k.dump', sizeBytes: 5_000_000_000, encrypted: true, ...times })).status).toBe(200);
    expect((await report({ kind: 'RESTORE_DRILL', status: 'SUCCESS', ...times })).status).toBe(200);

    expect(await getBackupHealth()).toMatchObject({ ok: true, issues: [] });
    const runs = await listBackupRuns();
    expect(runs.find((r) => r.kind === 'BACKUP')?.sizeBytes).toBe(5_000_000_000);

    await report({ status: 'FAILED', error: 'pg_dump: connection refused', startedAt: times.finishedAt, finishedAt: new Date(now.getTime() + 1000).toISOString() });
    const health = await getBackupHealth();
    expect(health.ok).toBe(false);
    expect(health.issues.join()).toMatch(/most recent backup run failed/);

    const watchdog = await GET(new Request('http://localhost/api/cron/backups', { headers: auth }));
    expect(watchdog.status).toBe(200);
  });
});

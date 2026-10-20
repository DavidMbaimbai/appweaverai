import { describe, expect, it } from 'vitest';

import { makeProjectFor, makeUser, prisma } from '@/tests/integration/db';

import { advanceRun, getOrCreateRun } from './engine';
import { getPipeline, listRuns, savePipeline, setPipelinePaused } from './service';

const config = {
  enabled: true,
  timeOfDay: '09:00',
  timeZone: 'UTC',
  postsPerDay: 2,
  platforms: ['X'],
  languages: ['en'],
  contentTypes: ['post'],
  preferredPostTimes: ['10:00', '15:30'],
  autoPublishCategories: [],
  objective: 'Grow signups',
  maxDailyCredits: 40,
};

async function seedPipeline() {
  const user = await makeUser();
  const { project } = await makeProjectFor(user);
  const scope = { type: 'PROJECT', projectId: project.id } as const;
  expect(await savePipeline(scope, config, user.id)).toEqual({ ok: true });
  const pipeline = await getPipeline(scope);
  return { user, project, scope, pipeline: pipeline! };
}

describe('content pipeline persistence and run de-duplication (real Postgres)', () => {
  it('persists a pipeline per scope and updates it in place', async () => {
    const { user, scope, project } = await seedPipeline();
    expect(await savePipeline(scope, { ...config, postsPerDay: 3, objective: 'More' }, user.id)).toEqual({ ok: true });
    const rows = await prisma.contentPipeline.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scopeKey: project.id,
      projectId: project.id,
      ownerUserId: user.id,
      postsPerDay: 3,
      preferredPostTimes: ['10:00', '15:30'],
      maxDailyCredits: 40,
      paused: false,
    });
    expect(await setPipelinePaused(scope, true)).toEqual({ ok: true });
    expect((await getPipeline(scope))?.paused).toBe(true);
  });

  it('rejects an invalid configuration without writing anything', async () => {
    const user = await makeUser();
    const { project } = await makeProjectFor(user);
    const result = await savePipeline({ type: 'PROJECT', projectId: project.id }, { ...config, timeOfDay: '25:99' }, user.id);
    expect(result.ok).toBe(false);
    expect(await prisma.contentPipeline.count()).toBe(0);
  });

  it('creates exactly one run per pipeline and date, even when many workers race', async () => {
    const { pipeline } = await seedPipeline();
    const results = await Promise.all(Array.from({ length: 10 }, () => getOrCreateRun(pipeline.id, '2026-03-10', 'cron')));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
    expect(await prisma.contentRun.count()).toBe(1);

    const nextDay = await getOrCreateRun(pipeline.id, '2026-03-11', 'cron');
    expect(nextDay.created).toBe(true);
    expect(await listRuns(pipeline.id)).toHaveLength(2);
  });

  it('does not re-run a day that already finished (cron re-run)', async () => {
    const { pipeline } = await seedPipeline();
    const { run } = await getOrCreateRun(pipeline.id, '2026-03-10', 'cron');
    await prisma.contentRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });

    const again = await advanceRun(pipeline.id, '2026-03-10', { trigger: 'cron' });
    expect(again).toMatchObject({ runId: run.id, status: 'SUCCEEDED', skipped: 'Already ran for this date.' });
    const concurrent = await Promise.all([advanceRun(pipeline.id, '2026-03-10'), advanceRun(pipeline.id, '2026-03-10')]);
    expect(concurrent.every((r) => r.skipped === 'Already ran for this date.')).toBe(true);
    expect(await prisma.contentRun.count()).toBe(1);
  });

  it('lets only one worker hold a running run at a time', async () => {
    const { pipeline } = await seedPipeline();
    const { run } = await getOrCreateRun(pipeline.id, '2026-03-12', 'cron');
    await prisma.contentRun.update({ where: { id: run.id }, data: { lockedUntil: new Date(Date.now() + 10 * 60_000) } });
    const result = await advanceRun(pipeline.id, '2026-03-12');
    expect(result.skipped).toBe('Another worker is running it.');
  });

  it('cascades runs when the pipeline is deleted', async () => {
    const { pipeline } = await seedPipeline();
    await getOrCreateRun(pipeline.id, '2026-03-10', 'cron');
    await prisma.contentPipeline.delete({ where: { id: pipeline.id } });
    expect(await prisma.contentRun.count()).toBe(0);
  });
});

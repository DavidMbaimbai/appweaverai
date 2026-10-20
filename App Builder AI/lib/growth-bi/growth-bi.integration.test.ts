import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma, resetDatabase } from '../../tests/integration/db';

vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn(async () => undefined) }));

import { eraseGrowthUserData } from './erase';
import { collectProject } from './project';
import { PLATFORM_SCOPE, rollupPlatform, rollupProjects, seriesFor } from './rollup';
import { trackFeature } from './track';

const DAY = '2026-03-10';
const at = (hour: number) => new Date(`${DAY}T${String(hour).padStart(2, '0')}:00:00Z`);
const from = new Date(`${DAY}T00:00:00Z`);
const to = new Date('2026-03-11T00:00:00Z');

async function seedProject() {
  const owner = await makeUser();
  const { project } = await makeProjectFor(owner);
  return { owner, project };
}

async function seedTraffic(projectId: string, views: number, leads: number) {
  for (let i = 0; i < views; i++) {
    await prisma.projectPageView.create({ data: { projectId, path: '/', visitorId: `v${i % 3}`, utm: i % 2 ? { source: 'facebook', medium: 'paid' } : undefined, createdAt: at(8 + (i % 5)) } });
  }
  for (let i = 0; i < leads; i++) {
    await prisma.lead.create({ data: { projectId, name: `L${i}`, email: `l${i}-${projectId}@example.test`, utm: { source: 'facebook', medium: 'paid' }, status: i === 0 ? 'WON' : 'NEW', createdAt: at(10) } });
  }
}

describe('growth BI (database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('never mixes one project\'s analytics into another\'s', async () => {
    const a = await seedProject();
    const b = await seedProject();
    await seedTraffic(a.project.id, 6, 2);
    await seedTraffic(b.project.id, 10, 5);

    const snapA = await collectProject(a.project.id, from, to);
    const snapB = await collectProject(b.project.id, from, to);
    expect(snapA.totals).toMatchObject({ views: 6, leads: 2, won: 1 });
    expect(snapB.totals).toMatchObject({ views: 10, leads: 5, won: 1 });

    await rollupProjects([DAY]);
    expect(await seriesFor('PROJECT', a.project.id, 'views', [DAY])).toEqual([6]);
    expect(await seriesFor('PROJECT', b.project.id, 'leads', [DAY])).toEqual([5]);
    expect(await seriesFor('PROJECT', 'someone-elses-id', 'views', [DAY])).toEqual([0]);
  });

  it('rollups are idempotent: re-running yields identical rows and no duplicates', async () => {
    const a = await seedProject();
    await seedTraffic(a.project.id, 6, 2);
    const user = await makeUser();
    await trackFeature(user.id, 'project.created', { projectId: a.project.id });

    const first = await rollupProjects([DAY]);
    await rollupPlatform([DAY], to);
    const snapshot = async () => (await prisma.growthRollup.findMany({ orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }, { dimension: 'asc' }, { dimKey: 'asc' }, { metric: 'asc' }] })).map((r) => [r.scopeType, r.scopeId, r.dimension, r.dimKey, r.metric, r.value]);
    const before = await snapshot();
    const again = await rollupProjects([DAY]);
    await rollupPlatform([DAY], to);
    expect(again.rows).toBe(first.rows);
    expect(await snapshot()).toEqual(before);

    await prisma.lead.create({ data: { projectId: a.project.id, name: 'Late', email: 'late@example.test', utm: { source: 'x', medium: 'y' }, createdAt: at(12) } });
    await rollupProjects([DAY]);
    expect(await seriesFor('PROJECT', a.project.id, 'leads', [DAY])).toEqual([3]);
    expect((await seriesFor(PLATFORM_SCOPE, PLATFORM_SCOPE, 'signups', [DAY]))[0]).toBeGreaterThanOrEqual(0);
  });

  it('feature events are deduplicated per day and erased with the account', async () => {
    const user = await makeUser();
    await trackFeature(user.id, 'project.created');
    await trackFeature(user.id, 'project.created');
    expect(await prisma.growthFeatureEvent.count({ where: { userId: user.id } })).toBe(1);
    await eraseGrowthUserData(user.id);
    expect(await prisma.growthFeatureEvent.count({ where: { userId: user.id } })).toBe(0);
  });
});

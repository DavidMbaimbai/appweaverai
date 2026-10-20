import { describe, expect, it } from 'vitest';

import { getDeploymentData, getOpsAccess } from '@/lib/ops/service';

import { makeProjectFor, makeUser, prisma } from './db';

async function deploy(projectId: string, userId: string, version: number, status: 'LIVE' | 'FAILED', createdAt = new Date()) {
  return prisma.deployment.create({
    data: {
      projectId,
      version,
      status,
      domain: `d${version}.example.test`,
      createdById: userId,
      createdAt,
      publishedAt: status === 'LIVE' ? createdAt : null,
    },
  });
}

describe('operations hub data', () => {
  it("never returns another tenant's deployments", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { project: projectA } = await makeProjectFor(a);
    const { project: projectB } = await makeProjectFor(b);

    await deploy(projectA.id, a.id, 1, 'LIVE');
    await deploy(projectA.id, a.id, 2, 'FAILED');
    const foreign = await deploy(projectB.id, b.id, 1, 'LIVE');
    await deploy(projectB.id, b.id, 2, 'LIVE');
    await deploy(projectB.id, b.id, 3, 'FAILED');

    const data = await getDeploymentData(projectA.id);
    expect(data.history).toHaveLength(2);
    expect(data.chartPoints).toHaveLength(2);
    expect(data.history.map((d) => d.id)).not.toContain(foreign.id);
    expect(data.history.every((d) => d.createdByName === a.email || d.createdByName === a.name)).toBe(true);
  });

  it('limits chart points to the window and grants access by role', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { project } = await makeProjectFor(owner);
    await deploy(project.id, owner.id, 1, 'LIVE', new Date(Date.now() - 200 * 86_400_000));
    await deploy(project.id, owner.id, 2, 'LIVE');

    const data = await getDeploymentData(project.id);
    expect(data.history).toHaveLength(2);
    expect(data.chartPoints).toHaveLength(1);

    expect(await getOpsAccess(project.id, owner.id)).toEqual({ member: true, owner: true });
    expect(await getOpsAccess(project.id, stranger.id)).toEqual({ member: false, owner: false });
  });
});

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@/lib/prisma';

import {
  publishedSnapshotDir,
  snapshotRoot,
  type SnapshotEnvironment,
} from './snapshot';

const VERSIONS_ROOT = path.join(process.cwd(), '.published-versions');

function versionDir(projectId: string, version: number) {
  return path.join(VERSIONS_ROOT, projectId, String(version));
}

/** Copies the live snapshot into a per-version folder so it can be rolled back to. */
export async function saveVersionSnapshot(
  projectId: string,
  version: number,
  artifactSlugs: string[],
  environment: SnapshotEnvironment = 'PRODUCTION',
) {
  const target = versionDir(projectId, version);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  for (const slug of artifactSlugs) {
    await cp(publishedSnapshotDir(projectId, slug, environment), path.join(target, slug), {
      recursive: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function hasVersionSnapshot(projectId: string, version: number) {
  try {
    return (await stat(versionDir(projectId, version))).isDirectory();
  } catch {
    return false;
  }
}

/** Makes a saved version the live snapshot again. */
export async function restoreVersionSnapshot(
  projectId: string,
  version: number,
  environment: SnapshotEnvironment = 'PRODUCTION',
) {
  const source = versionDir(projectId, version);
  const slugs = await readdir(source);
  const liveRoot = snapshotRoot(projectId, environment);

  await rm(liveRoot, { recursive: true, force: true });
  await mkdir(liveRoot, { recursive: true });
  for (const slug of slugs) {
    await cp(path.join(source, slug), path.join(liveRoot, slug), {
      recursive: true,
    });
  }
}

/**
 * Keeps only the newest `keep` deployment versions (the current one is always
 * kept) and deletes the rest along with their saved snapshots.
 */
export async function enforceDeploymentRetention(
  projectId: string,
  keep: number,
) {
  const deployments = await prisma.deployment.findMany({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, isCurrent: true, environment: true, status: true },
  });

  const retained = new Set(
    deployments.slice(0, Math.max(1, keep)).map((d) => d.id),
  );
  const isLive = (d: (typeof deployments)[number]) =>
    d.isCurrent || (d.environment === 'STAGING' && d.status === 'LIVE');
  const expired = deployments.filter((d) => !retained.has(d.id) && !isLive(d));
  if (expired.length === 0) return 0;

  await prisma.deployment.deleteMany({
    where: { id: { in: expired.map((d) => d.id) } },
  });
  await Promise.all(
    expired.map((d) =>
      rm(versionDir(projectId, d.version), { recursive: true, force: true }),
    ),
  );
  return expired.length;
}

import { readdir } from 'node:fs/promises';

import { prisma } from '@/lib/prisma';
import { publishedPath } from '@/lib/publish/visibility';
import { publishedSnapshotDir } from '@/lib/publish/snapshot';

const KEEP_CHECKS = 50;
const HTTP_TIMEOUT_MS = 8_000;

export type HealthCheckResult = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  detail: string;
};

export function summarizeChecks(checks: { ok: boolean }[]) {
  const total = checks.length;
  const passed = checks.filter((c) => c.ok).length;
  return {
    total,
    passed,
    uptimePercent: total === 0 ? null : Math.round((passed / total) * 1000) / 10,
  };
}

async function hasSnapshotFiles(projectId: string, slugs: string[]) {
  for (const slug of slugs) {
    try {
      if ((await readdir(publishedSnapshotDir(projectId, slug))).length > 0) {
        return true;
      }
    } catch {
      // Missing directory means no files for this artifact.
    }
  }
  return false;
}

/**
 * Checks the live deployment: it must exist and be LIVE, its published files
 * must be present, and (for public deployments) the public URL must answer 2xx.
 */
export async function checkProjectHealth(
  projectId: string,
  origin: string,
): Promise<HealthCheckResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      slug: true,
      workspace: { select: { slug: true } },
      artifacts: { select: { slug: true } },
      deployments: {
        where: { isCurrent: true },
        take: 1,
        select: { status: true, visibility: true, version: true },
      },
    },
  });

  const deployment = project?.deployments[0];
  if (!project || !deployment) {
    return { ok: false, statusCode: null, latencyMs: null, detail: 'Not published.' };
  }
  if (deployment.status !== 'LIVE') {
    return {
      ok: false,
      statusCode: null,
      latencyMs: null,
      detail: `Current deployment v${deployment.version} is ${deployment.status}.`,
    };
  }
  if (
    !(await hasSnapshotFiles(
      projectId,
      project.artifacts.map((a) => a.slug),
    ))
  ) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: null,
      detail: 'Published files are missing on the server. Publish again.',
    };
  }
  if (deployment.visibility !== 'PUBLIC') {
    return {
      ok: true,
      statusCode: null,
      latencyMs: null,
      detail:
        'Deployment is live and files are present. HTTP probe skipped because the site is not public.',
    };
  }

  const url = new URL(publishedPath(project.workspace.slug, project.slug), origin);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    return {
      ok: response.ok,
      statusCode: response.status,
      latencyMs,
      detail: response.ok
        ? `Public URL responded ${response.status} in ${latencyMs} ms.`
        : `Public URL responded ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: null,
      detail: `Public URL request failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }
}

export async function recordHealthCheck(
  projectId: string,
  result: HealthCheckResult,
) {
  const created = await prisma.projectHealthCheck.create({
    data: { projectId, ...result },
  });

  const stale = await prisma.projectHealthCheck.findMany({
    where: { projectId },
    orderBy: { checkedAt: 'desc' },
    skip: KEEP_CHECKS,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.projectHealthCheck.deleteMany({
      where: { id: { in: stale.map((s) => s.id) } },
    });
  }
  return created;
}

export async function getHealthHistory(projectId: string) {
  const checks = await prisma.projectHealthCheck.findMany({
    where: { projectId },
    orderBy: { checkedAt: 'desc' },
    take: KEEP_CHECKS,
    select: {
      ok: true,
      statusCode: true,
      latencyMs: true,
      detail: true,
      checkedAt: true,
    },
  });
  return {
    last: checks[0]
      ? { ...checks[0], checkedAt: checks[0].checkedAt.toISOString() }
      : null,
    ...summarizeChecks(checks),
  };
}

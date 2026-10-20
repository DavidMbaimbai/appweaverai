'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { rollbackDeploymentAction } from '@/lib/actions/deployments';
import { promoteStagingToProductionAction } from '@/lib/actions/staging';
import { getCachedSession } from '@/lib/auth/cached';
import { checkProjectHealth, recordHealthCheck } from '@/lib/hosting/health';
import { getOpsAccess } from '@/lib/ops/service';
import { appOrigin } from '@/lib/observatory/smoke';
import { restoreProjectCheckpoint } from '@/lib/project-checkpoints';
import { exportProjectToGithub } from '@/lib/project-github-export';
import { prisma } from '@/lib/prisma';
import type { PublishVisibility } from '@/lib/publish/visibility';

type Failure = { error: string };

/** Signed-in project owner required; members get read-only access to the hub. */
async function requireOwner(projectId: string): Promise<{ userId: string } | Failure> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' };
  const access = await getOpsAccess(projectId, userId);
  if (!access.member) return { error: 'Project not found.' };
  if (!access.owner) return { error: 'Only the project owner can do this.' };
  return { userId };
}

async function refresh(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true, workspace: { select: { slug: true } } },
  });
  if (project) {
    revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}/operations`);
  }
}

export async function opsRollbackAction(projectId: string, deploymentId: string) {
  const auth = await requireOwner(projectId);
  if ('error' in auth) return auth;
  const result = await rollbackDeploymentAction(projectId, deploymentId);
  await refresh(projectId);
  return result;
}

export async function opsPromoteAction(projectId: string, visibility: PublishVisibility) {
  const auth = await requireOwner(projectId);
  if ('error' in auth) return auth;
  const result = await promoteStagingToProductionAction(projectId, visibility);
  await refresh(projectId);
  return result;
}

export async function opsRunHealthCheckAction(projectId: string) {
  const auth = await requireOwner(projectId);
  if ('error' in auth) return auth;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const origin = appOrigin() || (host ? `${h.get('x-forwarded-proto') ?? 'https'}://${host}` : '');
  if (!origin) return { error: 'Cannot determine the app origin for the health check.' };

  const result = await checkProjectHealth(projectId, origin);
  await recordHealthCheck(projectId, result);
  await recordUserActivity({
    userId: auth.userId,
    action: 'project.health_check_run',
    targetType: 'Project',
    targetId: projectId,
    after: { ok: result.ok, statusCode: result.statusCode },
  });
  await refresh(projectId);
  return { success: true as const, ok: result.ok, detail: result.detail };
}

export async function opsRestoreCheckpointAction(projectId: string, checkpointId: string) {
  const auth = await requireOwner(projectId);
  if ('error' in auth) return auth;
  const result = await restoreProjectCheckpoint({ projectId, checkpointId, actorId: auth.userId });
  if ('error' in result) return result;
  await recordUserActivity({
    userId: auth.userId,
    action: 'project.checkpoint_restored',
    targetType: 'Project',
    targetId: projectId,
    after: { checkpointId, restoredFiles: result.restoredFiles, removedFiles: result.removedFiles },
  });
  await refresh(projectId);
  return result;
}

export async function opsPushGithubAction(projectId: string) {
  const auth = await requireOwner(projectId);
  if ('error' in auth) return auth;
  try {
    const result = await exportProjectToGithub({ projectId, userId: auth.userId });
    await recordUserActivity({
      userId: auth.userId,
      action: 'project.github_exported',
      targetType: 'Project',
      targetId: projectId,
      after: { repo: `${result.repoOwner}/${result.repoName}`, fileCount: result.fileCount },
    });
    await refresh(projectId);
    return { success: true as const, repo: `${result.repoOwner}/${result.repoName}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not push to GitHub.' };
  }
}

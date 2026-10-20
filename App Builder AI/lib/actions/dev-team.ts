'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { getCachedSession } from '@/lib/auth/cached';
import { executeRun } from '@/lib/dev-team/engine';
import { approveAndApply, cancelRun, rejectRun, resolveConflict, startRun, type ConflictChoice } from '@/lib/dev-team/lifecycle';
import { getAccessibleProject } from '@/lib/projects/access';
import { rateLimit } from '@/lib/rate-limit';
import { DEV_TEAM_DEFAULTS } from '@/lib/dev-team/types';

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function authorize(projectId: string) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' } as const;
  const project = await getAccessibleProject(projectId, userId, { id: true, slug: true, workspaceId: true, workspace: { select: { slug: true } } });
  if (!project) return { error: 'Project not found.' } as const;
  return { userId, project } as const;
}

function refresh(project: { slug: string; workspace: { slug: string } }) {
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}/team`);
}

export async function startDevTeamRunAction(projectId: string, goal: string): Promise<Result> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { ok: false, error: auth.error };
  const limit = await rateLimit(`dev-team-start:${auth.userId}`, DEV_TEAM_DEFAULTS.runsPerHour, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: `Too many runs. Try again in ${limit.retryAfter}s.` };

  const started = await startRun({ userId: auth.userId, projectId: auth.project.id, workspaceId: auth.project.workspaceId, goal: String(goal ?? '') });
  if (!started.ok) return started;
  const { runId } = started;
  after(async () => {
    await executeRun({ runId, projectId: auth.project.id });
  });
  refresh(auth.project);
  return { ok: true, message: 'The AI team started working.' };
}

export async function cancelDevTeamRunAction(projectId: string, runId: string): Promise<Result> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { ok: false, error: auth.error };
  const limit = await rateLimit(`dev-team-act:${auth.userId}`, 60, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: 'Too many requests. Try again shortly.' };
  const result = await cancelRun({ userId: auth.userId, projectId: auth.project.id, runId });
  refresh(auth.project);
  return result.ok ? { ok: true } : result;
}

export async function resolveDevTeamConflictAction(projectId: string, runId: string, path: string, choice: ConflictChoice): Promise<Result> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { ok: false, error: auth.error };
  const limit = await rateLimit(`dev-team-act:${auth.userId}`, 60, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: 'Too many requests. Try again shortly.' };
  const result = await resolveConflict({ userId: auth.userId, projectId: auth.project.id, runId, path: String(path), choice });
  refresh(auth.project);
  return result.ok ? { ok: true } : result;
}

export async function approveDevTeamRunAction(
  projectId: string,
  runId: string,
  input: { reason: string; acknowledgeNotRun: boolean; acknowledgeProtected: boolean },
): Promise<Result> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { ok: false, error: auth.error };
  const limit = await rateLimit(`dev-team-apply:${auth.userId}`, 20, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: 'Too many requests. Try again shortly.' };
  const result = await approveAndApply({
    userId: auth.userId,
    projectId: auth.project.id,
    runId,
    reason: String(input?.reason ?? ''),
    acknowledgeNotRun: input?.acknowledgeNotRun === true,
    acknowledgeProtected: input?.acknowledgeProtected === true,
  });
  refresh(auth.project);
  return result.ok ? { ok: true, message: `Applied ${result.applied.length} file(s).` } : result;
}

export async function rejectDevTeamRunAction(projectId: string, runId: string, reason: string): Promise<Result> {
  const auth = await authorize(projectId);
  if ('error' in auth && auth.error) return { ok: false, error: auth.error };
  const limit = await rateLimit(`dev-team-act:${auth.userId}`, 60, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: 'Too many requests. Try again shortly.' };
  const result = await rejectRun({ userId: auth.userId, projectId: auth.project.id, runId, reason: String(reason ?? '') });
  refresh(auth.project);
  return result.ok ? { ok: true } : result;
}

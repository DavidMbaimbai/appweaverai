'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import type { AgentScope } from '@/lib/agents/types';

import { runScopeNow, savePipeline, setPipelinePaused } from './service';

type ActionResult = { success: true; message?: string } | { error: string };

/** Only the project's creator or its workspace owner may configure the pipeline. */
async function requireProjectOwner(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, OR: [{ createdById: userId }, { workspace: { ownerId: userId } }] },
    select: { id: true, slug: true, workspace: { select: { slug: true } } },
  });
  return project ? { userId, project } : null;
}

function refreshProject(owner: NonNullable<Awaited<ReturnType<typeof requireProjectOwner>>>) {
  revalidatePath(`/app/projects/${owner.project.workspace.slug}/${owner.project.slug}/content-pipeline`);
}

export async function saveProjectPipelineAction(projectId: string, input: Record<string, unknown>): Promise<ActionResult> {
  const owner = await requireProjectOwner(projectId);
  if (!owner) return { error: 'Only the project owner can change the pipeline.' };
  const result = await savePipeline({ type: 'PROJECT', projectId }, input, owner.userId);
  if (!result.ok) return { error: result.error };
  refreshProject(owner);
  return { success: true };
}

export async function pauseProjectPipelineAction(projectId: string, paused: boolean): Promise<ActionResult> {
  const owner = await requireProjectOwner(projectId);
  if (!owner) return { error: 'Only the project owner can change the pipeline.' };
  const result = await setPipelinePaused({ type: 'PROJECT', projectId }, paused);
  if (!result.ok) return { error: result.error };
  refreshProject(owner);
  return { success: true };
}

export async function runProjectPipelineNowAction(projectId: string): Promise<ActionResult> {
  const owner = await requireProjectOwner(projectId);
  if (!owner) return { error: 'Only the project owner can run the pipeline.' };
  const result = await runScopeNow({ type: 'PROJECT', projectId });
  refreshProject(owner);
  return result.ok ? { success: true, message: `Run finished with status ${result.status}.` } : { error: result.error };
}

const PLATFORM: AgentScope = { type: 'PLATFORM' };

export async function savePlatformPipelineAction(input: Record<string, unknown>): Promise<ActionResult> {
  const auth = await requireAdmin('contentpipeline:write');
  if (!auth.ok) return { error: 'Not allowed.' };
  const result = await savePipeline(PLATFORM, input, auth.admin.id);
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/content-pipeline');
  return { success: true };
}

export async function pausePlatformPipelineAction(paused: boolean): Promise<ActionResult> {
  const auth = await requireAdmin('contentpipeline:write');
  if (!auth.ok) return { error: 'Not allowed.' };
  const result = await setPipelinePaused(PLATFORM, paused);
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/content-pipeline');
  return { success: true };
}

export async function runPlatformPipelineNowAction(): Promise<ActionResult> {
  const auth = await requireAdmin('contentpipeline:write');
  if (!auth.ok) return { error: 'Not allowed.' };
  const result = await runScopeNow(PLATFORM);
  revalidatePath('/admin/content-pipeline');
  return result.ok ? { success: true, message: `Run finished with status ${result.status}.` } : { error: result.error };
}

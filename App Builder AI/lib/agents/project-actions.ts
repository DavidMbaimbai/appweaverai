'use server';

import { revalidatePath } from 'next/cache';

import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';

import { approveActivity, pauseActivity, rejectActivity, retryActivity } from './decisions';
import { saveAgentSetting, setAgentPaused, type AgentSettingInput } from './settings';
import { isAgentRole, type AgentScope } from './types';

type ActionResult = { success: true } | { error: string };

/** Only the project's creator or its workspace owner may configure agents. */
async function requireProjectOwner(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) return null;
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [{ createdById: userId }, { workspace: { ownerId: userId } }],
    },
    select: { id: true, slug: true, workspace: { select: { slug: true } } },
  });
  return project ? { userId, project } : null;
}

function refresh(owner: NonNullable<Awaited<ReturnType<typeof requireProjectOwner>>>) {
  revalidatePath(`/app/projects/${owner.project.workspace.slug}/${owner.project.slug}/agents`);
}

export async function saveProjectAgentAction(projectId: string, agent: string, input: AgentSettingInput): Promise<ActionResult> {
  const owner = await requireProjectOwner(projectId);
  if (!owner) return { error: 'Only the project owner can change agents.' };
  const scope: AgentScope = { type: 'PROJECT', projectId };
  const result = await saveAgentSetting(scope, agent, input, owner.userId);
  if (!result.ok) return { error: result.error };
  refresh(owner);
  return { success: true };
}

/** Instant pause/resume/disable that never needs the settings form. */
export async function setProjectAgentStateAction(
  projectId: string,
  agent: string,
  state: 'pause' | 'resume' | 'disable',
): Promise<ActionResult> {
  const owner = await requireProjectOwner(projectId);
  if (!owner) return { error: 'Only the project owner can change agents.' };
  if (!isAgentRole(agent)) return { error: 'Unknown agent.' };
  await setAgentPaused({ type: 'PROJECT', projectId }, agent, state === 'pause', state === 'disable');
  refresh(owner);
  return { success: true };
}

export async function decideProjectActivityAction(
  projectId: string,
  id: string,
  decision: 'approve' | 'reject' | 'retry' | 'pause',
): Promise<ActionResult> {
  const owner = await requireProjectOwner(projectId);
  if (!owner) return { error: 'Only the project owner can change agents.' };
  const scope: AgentScope = { type: 'PROJECT', projectId };
  const result =
    decision === 'approve'
      ? await approveActivity(id, owner.userId, scope)
      : decision === 'reject'
        ? await rejectActivity(id, owner.userId, scope)
        : decision === 'pause'
          ? await pauseActivity(id, owner.userId, scope)
          : await retryActivity(id, scope);
  refresh(owner);
  return result.ok ? { success: true } : { error: result.error };
}

'use server';

import { revalidatePath } from 'next/cache';

import { approveActivity, rejectActivity } from '../agents/decisions';
import { getCachedSession } from '../auth/cached';
import { recommendForProject } from '../growth-bi/service';
import { prisma } from '../prisma';
import { projectAccessWhere } from '../projects/access';

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function generateProjectRecommendationsAction(projectId: string): Promise<Result> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { ok: false, error: 'Unauthorized' };
  const result = await recommendForProject(userId, String(projectId));
  if (!result.ok) return result;
  revalidatePath('/app/projects');
  const rejected = result.rejected.length ? ` ${result.rejected.length} ungrounded suggestion(s) were discarded.` : '';
  return { ok: true, message: result.created ? `${result.created} recommendation(s) ready for your approval (${result.credits} credits).${rejected}` : `No well-supported recommendation could be made, so you were not charged.${rejected}` };
}

export async function decideProjectRecommendationAction(id: string, decision: 'approve' | 'reject'): Promise<Result> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { ok: false, error: 'Unauthorized' };
  const rec = await prisma.growthRecommendation.findFirst({ where: { id: String(id), scopeType: 'PROJECT', status: 'PROPOSED' }, select: { scopeId: true, agentActivityId: true } });
  if (!rec?.agentActivityId) return { ok: false, error: 'Recommendation not found or already decided.' };
  const project = await prisma.project.findFirst({ where: { id: rec.scopeId, ...projectAccessWhere(userId) }, select: { id: true } });
  if (!project) return { ok: false, error: 'Recommendation not found or already decided.' };
  const scope = { type: 'PROJECT', projectId: project.id } as const;
  const result = decision === 'approve' ? await approveActivity(rec.agentActivityId, userId, scope) : await rejectActivity(rec.agentActivityId, userId, scope);
  if (!result.ok) return { ok: false, error: result.error };
  if (decision === 'reject') await prisma.growthRecommendation.updateMany({ where: { id: String(id), status: 'PROPOSED' }, data: { status: 'REJECTED' } });
  revalidatePath('/app/projects');
  return { ok: true, message: decision === 'approve' ? 'Accepted. Nothing was changed automatically.' : 'Rejected.' };
}

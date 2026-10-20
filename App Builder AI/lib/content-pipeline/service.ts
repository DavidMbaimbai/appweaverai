import { prisma } from '@/lib/prisma';
import { scopeId, type AgentScope } from '@/lib/agents/types';

import { runPipelineNow } from './engine';
import { normalizeConfig } from './logic';

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function getPipeline(scope: AgentScope) {
  return prisma.contentPipeline.findUnique({ where: { scopeKey: scopeId(scope) } });
}

export async function listRuns(pipelineId: string, take = 20) {
  return prisma.contentRun.findMany({ where: { pipelineId }, orderBy: { runDate: 'desc' }, take });
}

/** Creates or updates the one pipeline of a scope. Callers must authorise `userId` first. */
export async function savePipeline(scope: AgentScope, input: Record<string, unknown>, userId: string): Promise<SaveResult> {
  const parsed = normalizeConfig(input, scope.type);
  if (!parsed.ok) return parsed;
  const c = parsed.value;
  const data = {
    enabled: c.enabled,
    timeOfDay: c.timeOfDay,
    timeZone: c.timeZone,
    postsPerDay: c.postsPerDay,
    platforms: c.platforms,
    languages: c.languages,
    contentTypes: c.contentTypes,
    preferredPostTimes: c.preferredPostTimes,
    autoPublishCategories: c.autoPublishCategories,
    objective: c.objective,
    maxDailyCredits: c.maxDailyCredits,
    ownerUserId: userId,
  };
  await prisma.contentPipeline.upsert({
    where: { scopeKey: scopeId(scope) },
    update: data,
    create: { ...data, scope: scope.type, scopeKey: scopeId(scope), projectId: scope.type === 'PROJECT' ? scope.projectId : null },
  });
  return { ok: true };
}

export async function setPipelinePaused(scope: AgentScope, paused: boolean): Promise<SaveResult> {
  const done = await prisma.contentPipeline.updateMany({ where: { scopeKey: scopeId(scope) }, data: { paused } });
  return done.count ? { ok: true } : { ok: false, error: 'Save the pipeline settings first.' };
}

export async function runScopeNow(scope: AgentScope): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const pipeline = await getPipeline(scope);
  if (!pipeline) return { ok: false, error: 'Save the pipeline settings first.' };
  if (pipeline.paused) return { ok: false, error: 'The pipeline is paused. Resume it first.' };
  const result = await runPipelineNow(pipeline.id);
  if (result.skipped && result.status !== 'WAITING' && result.status !== 'RUNNING') return { ok: false, error: result.skipped };
  return { ok: true, status: result.status };
}

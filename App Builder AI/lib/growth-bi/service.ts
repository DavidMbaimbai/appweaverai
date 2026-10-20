import { getAnthropicClient } from '@/lib/anthropic';
import { registerAgentExecutor } from '@/lib/agents/executors';
import { runAgentAction } from '@/lib/agents/run';
import type { AgentScope } from '@/lib/agents/types';
import type { Prisma } from '@/lib/generated/prisma/client';
import { withMarketingCredits } from '@/lib/marketing-credits/run';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';
import { rateLimit } from '@/lib/rate-limit';

import { buildUtmUrl, type UtmKind } from './attribution';
import { collectPlatform, platformCatalog } from './platform';
import { collectProject, projectCatalog } from './project';
import { buildRecommendationCall, dataSufficiency, parseRecommendations, type CatalogMetric, type RecommendationScope } from './recommend';

const MODEL = process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';
const DAY = 86_400_000;
export const RECOMMENDATION_ACTION = 'growth.recommendation.apply';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Approval only records the decision; it has no external effect, so nothing here can spend money or publish. */
registerAgentExecutor(RECOMMENDATION_ACTION, async (ctx) => {
  const id = (ctx.payload as { recommendationId?: string } | null)?.recommendationId;
  if (id) await prisma.growthRecommendation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: 'ACCEPTED' } });
  return { summary: 'Recommendation accepted by a human. No automatic change was made; follow the proposed action manually.' };
});

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function askModel(scope: RecommendationScope, catalog: CatalogMetric[], days: number) {
  const call = buildRecommendationCall(scope, catalog, days);
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: call.system,
    messages: call.messages,
  });
  const block = response.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

async function storeAndQueue(scope: AgentScope, scopeType: RecommendationScope, scopeId: string, userId: string, raw: string, catalog: CatalogMetric[], days: number) {
  const { accepted, rejected } = parseRecommendations(raw, catalog, { allowedNumbers: [days] });
  const created: string[] = [];
  for (const a of accepted) {
    const row = await prisma.growthRecommendation.create({
      data: {
        scopeType,
        scopeId,
        title: a.recommendation.title,
        rationale: a.recommendation.rationale,
        metricIds: a.recommendation.metricIds,
        evidence: json(a.evidence),
        proposedAction: json(a.recommendation.action),
        createdById: userId,
      },
    });
    const run = await runAgentAction({
      scope,
      agent: 'GROWTH_ANALYST',
      action: RECOMMENDATION_ACTION,
      category: 'report',
      risk: 'HIGH',
      input: a.recommendation.title,
      payload: { recommendationId: row.id },
      idempotencyKey: `growth-rec:${row.id}`,
    });
    await prisma.growthRecommendation.update({ where: { id: row.id }, data: { agentActivityId: run.activityId } });
    created.push(row.id);
  }
  return { created: created.length, rejected };
}

export async function recommendForPlatform(userId: string, days = 30): Promise<Result<{ created: number; rejected: { title: string; reason: string }[]; credits: number }>> {
  const limit = await rateLimit(`growth-rec:platform:${userId}`, 6, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };
  const to = new Date();
  const snap = await collectPlatform(new Date(to.getTime() - days * DAY), to);
  const catalog = platformCatalog(snap);
  const enough = dataSufficiency('PLATFORM', catalog);
  if (!enough.ok) return { ok: false, error: enough.reason };
  const outcome = await withMarketingCredits(
    { userId, projectId: null, operation: 'growth_draft', claimedBilling: 'APPWEAVER_INTERNAL', refType: 'growth_recommendation', isFailure: (v) => v.created === 0 },
    async () => storeAndQueue({ type: 'PLATFORM' }, 'PLATFORM', 'PLATFORM', userId, await askModel('PLATFORM', catalog, days), catalog, days),
  );
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, created: outcome.value.created, rejected: outcome.value.rejected, credits: outcome.charged };
}

export async function recommendForProject(userId: string, projectId: string, days = 30): Promise<Result<{ created: number; rejected: { title: string; reason: string }[]; credits: number }>> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true } });
  if (!project) return { ok: false, error: 'Project not found.' };
  const limit = await rateLimit(`growth-rec:project:${userId}`, 6, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };
  const to = new Date();
  const snap = await collectProject(projectId, new Date(to.getTime() - days * DAY), to);
  const catalog = projectCatalog(snap);
  const enough = dataSufficiency('PROJECT', catalog);
  if (!enough.ok) return { ok: false, error: enough.reason };
  const outcome = await withMarketingCredits(
    { userId, projectId, operation: 'growth_draft', refType: 'growth_recommendation', isFailure: (v) => v.created === 0 },
    async () => storeAndQueue({ type: 'PROJECT', projectId }, 'PROJECT', projectId, userId, await askModel('PROJECT', catalog, days), catalog, days),
  );
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, created: outcome.value.created, rejected: outcome.value.rejected, credits: outcome.charged };
}

export async function listRecommendations(scopeType: RecommendationScope, scopeId: string) {
  return prisma.growthRecommendation.findMany({ where: { scopeType, scopeId }, orderBy: { createdAt: 'desc' }, take: 20 });
}

export async function createUtmLink(userId: string, input: { baseUrl: string; source: string; medium: string; campaign: string; content?: string; kind: UtmKind; label?: string }): Promise<Result<{ url: string }>> {
  const built = buildUtmUrl(input);
  if (!built.ok) return { ok: false, error: built.error };
  await prisma.growthLink.create({
    data: {
      label: (input.label || input.campaign).slice(0, 120),
      baseUrl: input.baseUrl.trim().slice(0, 500),
      source: input.source.trim().toLowerCase(),
      medium: input.medium.trim().toLowerCase(),
      campaign: input.campaign.trim().toLowerCase(),
      content: input.content?.trim().toLowerCase() || null,
      kind: input.kind,
      url: built.url,
      createdById: userId,
    },
  });
  return { ok: true, url: built.url };
}

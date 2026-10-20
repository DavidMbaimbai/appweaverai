import { getAnthropicClient } from '@/lib/anthropic';
import { generateCampaignPosts } from '@/lib/project-marketing/generate';
import { rateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';
import { summarizeReviews } from '@/lib/project-reviews/stats';

import {
  canTransition,
  isMeasurementDue,
  measurementDueAt,
  parseProposals,
  resultNote,
  toWindow,
  type ExperimentStatus,
  type MetricWindow,
  type ProposedAction,
} from './experiments';
import { collectGrowth, GROWTH_CAVEAT, type MetricKey } from './metrics';

const MODEL = process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';
const DAY = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 14;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const periodFor = (days: number, now = new Date()) => ({ from: new Date(now.getTime() - days * DAY), to: now });

const SYSTEM = `You are a cautious growth analyst for a small app/business. You receive measured metrics from the owner's own data.
Rules:
- Cite ONLY numbers present in the input. Never invent, estimate or extrapolate figures, benchmarks, industry averages or competitor data.
- Metrics listed as not_available are unknown: never treat them as zero or guess them. You may propose connecting a source as a MANUAL action.
- Never promise or predict outcomes ("will increase", "guaranteed", multipliers, percentages of uplift). Phrase hypotheses as things to test.
- Past experiments show before/after numbers that are correlations, not proof of cause; do not claim causation.
- Propose 1-4 experiments, prioritised (priority 1 = highest). Each must be doable with ONLY these existing safe actions, none of which spends money or publishes automatically:
  MARKETING_CAMPAIGN_DRAFT (brief for a drafted social campaign the owner reviews), DEV_TICKET (a ticket for a repeated feature request or problem), LANDING_PAGE_PROMPT (a prompt for the app builder to change the landing page, owner applies it), MANUAL (an owner task).
- "metricKey" is the single metric to compare before/after; it must be one of the provided metric keys and measured.
- "citedMetrics" must list {key,value} pairs copied exactly from the input that justify the experiment.
Return ONLY JSON: {"experiments":[{"hypothesis":"...","bottleneck":"...","estimatedCostCents":null,"action":{"type":"...","title":"...","brief":"...","metricKey":"...","priority":1,"citedMetrics":[{"key":"...","value":0}]}}]}`;

async function ownedExperiment(userId: string, id: string) {
  return prisma.growthExperiment.findFirst({
    where: { id, project: projectAccessWhere(userId) },
    include: { project: { select: { id: true, name: true, slug: true, description: true, workspace: { select: { slug: true } } } } },
  });
}

export async function proposeExperiments(userId: string, projectId: string, days = 30): Promise<Result<{ created: number }>> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true, name: true, description: true } });
  if (!project) return { ok: false, error: 'Project not found.' };
  const limit = await rateLimit(`growth-agent:${userId}`, 6, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };

  const { from, to } = periodFor(days);
  const snapshot = await collectGrowth(projectId, from, to);
  const measured = snapshot.metrics.filter((m) => m.value != null);
  if (!measured.length) return { ok: false, error: 'No measured data yet. Publish your app or capture leads first.' };

  const [reviews, past] = await Promise.all([
    prisma.projectReview.findMany({ where: { projectId }, select: { rating: true, sentiment: true, topic: true }, take: 300 }),
    prisma.growthExperiment.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  const topics = summarizeReviews(reviews).topics.slice(0, 5);
  const pastInput = past.map((p) => ({
    status: p.status,
    hypothesis: p.hypothesis,
    metricBefore: (p.metricBefore as MetricWindow | null)?.value ?? null,
    metricAfter: (p.metricAfter as MetricWindow | null)?.value ?? null,
    resultNote: p.resultNote,
  }));
  const input = {
    periodDays: days,
    metrics: snapshot.metrics.map((m) => ({ key: m.key, label: m.label, status: m.status, value: m.value })),
    leadsBySource: snapshot.leadsBySource,
    leadsByUtm: snapshot.leadsByUtm,
    reviewTopics: topics,
    pastExperiments: pastInput,
    caveat: GROWTH_CAVEAT,
  };
  const extra = [days, ...snapshot.leadsBySource.map((b) => b.count), ...snapshot.leadsByUtm.map((b) => b.count), ...topics.map((t) => t.count)];

  let raw = '';
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    const block = response.content.find((c) => c.type === 'text');
    raw = block && block.type === 'text' ? block.text : '';
  } catch (error) {
    console.error('[growth] agent failed:', error);
    return { ok: false, error: 'The growth agent is unavailable right now.' };
  }

  const proposals = parseProposals(raw, snapshot.metrics, extra);
  if (!proposals.length) return { ok: false, error: 'No well-supported experiment could be proposed from the current data.' };

  const open = await prisma.growthExperiment.findMany({
    where: { projectId, status: { in: ['PROPOSED', 'APPROVED', 'RUNNING'] } },
    select: { proposedAction: true },
  });
  const openTitles = new Set(open.map((o) => (o.proposedAction as ProposedAction).title));
  const fresh = proposals.filter((p) => !openTitles.has(p.action.title));
  for (const p of fresh) {
    await prisma.growthExperiment.create({
      data: {
        projectId,
        hypothesis: p.hypothesis,
        bottleneck: p.bottleneck,
        proposedAction: p.action,
        estimatedCostCents: p.estimatedCostCents,
        windowDays: DEFAULT_WINDOW_DAYS,
      },
    });
  }
  return { ok: true, created: fresh.length };
}

async function move(userId: string, id: string, to: ExperimentStatus, data: Record<string, unknown> = {}): Promise<Result> {
  const exp = await ownedExperiment(userId, id);
  if (!exp) return { ok: false, error: 'Experiment not found.' };
  if (!canTransition(exp.status as ExperimentStatus, to)) return { ok: false, error: `Cannot move from ${exp.status} to ${to}.` };
  // Compare-and-set so concurrent clicks can't double-apply a transition.
  const res = await prisma.growthExperiment.updateMany({ where: { id, status: exp.status }, data: { status: to, ...data } });
  return res.count ? { ok: true } : { ok: false, error: 'Experiment changed; refresh and try again.' };
}

export const approveExperiment = (userId: string, id: string) => move(userId, id, 'APPROVED', { approvedById: userId });
export const rejectExperiment = (userId: string, id: string) => move(userId, id, 'REJECTED');

async function projectUrl(projectId: string) {
  const deployment = await prisma.deployment.findFirst({ where: { projectId, isCurrent: true, status: 'LIVE' }, select: { domain: true, customDomain: true } });
  const host = deployment?.customDomain || deployment?.domain;
  return host ? `https://${host}` : null;
}

/** Runs the approved action (drafts/tickets/prompts only), records the baseline, and starts the measurement clock. */
export async function startExperiment(userId: string, id: string): Promise<Result<{ message: string }>> {
  const exp = await ownedExperiment(userId, id);
  if (!exp) return { ok: false, error: 'Experiment not found.' };
  if (!canTransition(exp.status as ExperimentStatus, 'RUNNING')) return { ok: false, error: 'Approve the experiment first.' };

  const action = exp.proposedAction as unknown as ProposedAction;
  const now = new Date();
  const beforeRange = { from: new Date(now.getTime() - exp.windowDays * DAY), to: now };
  const before = toWindow(action.metricKey as MetricKey, (await collectGrowth(exp.projectId, beforeRange.from, beforeRange.to)).metrics, exp.windowDays, beforeRange.from, beforeRange.to);

  const claimed = await prisma.growthExperiment.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'RUNNING', startedAt: now, metricBefore: before } });
  if (!claimed.count) return { ok: false, error: 'Experiment changed; refresh and try again.' };

  let execution: Record<string, unknown> = {};
  let message = 'Experiment started.';
  try {
    if (action.type === 'MARKETING_CAMPAIGN_DRAFT') {
      const result = await generateCampaignPosts(
        { name: exp.project.name, description: exp.project.description, url: await projectUrl(exp.projectId), brandKit: null },
        action.brief.slice(0, 1500),
        'UTC',
      );
      if (!result) throw new Error('Could not produce a safe campaign.');
      const campaign = await prisma.projectCampaign.create({
        data: {
          projectId: exp.projectId,
          userId,
          name: result.name,
          brief: action.brief.slice(0, 1500),
          posts: { create: result.posts.map((p) => ({ platform: p.platform, text: p.text, hashtags: p.hashtags, scheduledAt: p.scheduledAt, timeZone: 'UTC' })) },
        },
        select: { id: true },
      });
      execution = { kind: 'campaign-draft', campaignId: campaign.id };
      message = 'Campaign drafted (nothing is published). Review it in Marketing.';
    } else if (action.type === 'DEV_TICKET') {
      const issue = await prisma.projectIssue.create({
        data: {
          projectId: exp.projectId,
          title: action.title.slice(0, 160),
          severity: 'low',
          createdById: userId,
          evidence: [{ type: 'growth-experiment', ref: `experiment:${exp.id}`, detail: `${action.brief} (cited: ${action.citedMetrics.map((c) => `${c.key}=${c.value}`).join(', ')})`.slice(0, 1500) }],
        },
        select: { id: true },
      });
      execution = { kind: 'dev-ticket', issueId: issue.id };
      message = 'Ticket created in Reviews & support → Issues.';
    } else if (action.type === 'LANDING_PAGE_PROMPT') {
      execution = {
        kind: 'landing-prompt',
        prompt: action.brief,
        builderHref: `/app/projects/${exp.project.workspace.slug}/${exp.project.slug}`,
      };
      message = 'Builder prompt prepared. Copy it into the builder to apply it yourself.';
    }
  } catch (error) {
    console.error('[growth] execution failed:', error);
    await prisma.growthExperiment.update({ where: { id }, data: { status: 'APPROVED', startedAt: null, metricBefore: undefined } });
    return { ok: false, error: 'Could not run the action. Nothing was changed; try again.' };
  }
  await prisma.growthExperiment.update({ where: { id }, data: { executionResult: execution as object } });
  return { ok: true, message };
}

/** Records the after-window once enough time has passed; the note is correlation-only by construction. */
export async function measureExperiment(userId: string, id: string, now = new Date()): Promise<Result> {
  const exp = await ownedExperiment(userId, id);
  if (!exp) return { ok: false, error: 'Experiment not found.' };
  if (!canTransition(exp.status as ExperimentStatus, 'MEASURED') || !exp.startedAt) return { ok: false, error: 'Experiment is not running.' };
  if (!isMeasurementDue(exp.startedAt, exp.windowDays, now)) {
    return { ok: false, error: `Measurement opens on ${measurementDueAt(exp.startedAt, exp.windowDays).toISOString().slice(0, 10)}.` };
  }
  const action = exp.proposedAction as unknown as ProposedAction;
  const to = measurementDueAt(exp.startedAt, exp.windowDays);
  const after = toWindow(action.metricKey as MetricKey, (await collectGrowth(exp.projectId, exp.startedAt, to)).metrics, exp.windowDays, exp.startedAt, to);
  const before = exp.metricBefore as unknown as MetricWindow;
  return move(userId, id, 'MEASURED', { metricAfter: after, measuredAt: now, resultNote: resultNote(before, after) });
}

import { prisma } from '@/lib/prisma';

import {
  redactSensitive,
  selectRelevantFeatures,
  toBundleFeatures,
  type EvidenceBundle,
} from './evidence-format';
import { searchKnowledge } from './retrieval';
import { callStatusWebhook } from './status-webhook';

const DAY = 24 * 60 * 60 * 1000;

export function emptyBundle(): EvidenceBundle {
  return {
    gatheredAt: new Date().toISOString(),
    features: [],
    deployment: null,
    health: null,
    smoke: null,
    incidents: [],
    recurring: [],
    knowledge: [],
    statusWebhook: null,
  };
}

async function safely<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error('Evidence lookup failed:', error);
    return fallback;
  }
}

/**
 * Collects only what the platform itself knows about the app. It never reads
 * customer payment/booking records; the optional owner status webhook receives
 * the review reference id only.
 */
export async function gatherEvidenceBundle(input: {
  projectId: string;
  reviewId: string;
  body: string;
  statusWebhookUrl?: string | null;
}): Promise<EvidenceBundle> {
  const { projectId } = input;
  const since = new Date(Date.now() - 90 * DAY);

  const [features, deployment, health, smoke, issues, topicReviews, knowledge, webhook] = await Promise.all([
    safely(prisma.appFeature.findMany({ where: { projectId } }), []),
    safely(
      prisma.deployment.findFirst({
        where: { projectId, isCurrent: true },
        select: { version: true, status: true, publishedAt: true },
      }),
      null,
    ),
    safely(
      prisma.projectHealthCheck.findFirst({
        where: { projectId },
        orderBy: { checkedAt: 'desc' },
        select: { ok: true, detail: true, checkedAt: true },
      }),
      null,
    ),
    safely(
      prisma.smokeCheck.findFirst({
        where: { projectId },
        orderBy: { checkedAt: 'desc' },
        select: { outcome: true, checkedAt: true, version: true },
      }),
      null,
    ),
    safely(
      prisma.projectIssue.findMany({
        where: { projectId, status: { notIn: ['VERIFIED', 'CLOSED'] } },
        select: { title: true, status: true },
        take: 5,
      }),
      [],
    ),
    safely(
      prisma.projectReview.groupBy({
        by: ['topic'],
        where: { projectId, sentiment: 'negative', createdAt: { gte: since } },
        _count: { _all: true },
      }),
      [],
    ),
    safely(prisma.projectKnowledge.findMany({ where: { projectId }, select: { id: true, title: true, content: true } }), []),
    input.statusWebhookUrl ? callStatusWebhook(input.statusWebhookUrl, input.reviewId) : Promise.resolve(null),
  ]);

  const relevant = selectRelevantFeatures(input.body, features);
  const bundle: EvidenceBundle = {
    gatheredAt: new Date().toISOString(),
    features: toBundleFeatures(relevant),
    deployment: deployment
      ? { version: deployment.version, status: deployment.status, publishedAt: deployment.publishedAt?.toISOString() ?? null }
      : null,
    health: health ? { ok: health.ok, detail: redactSensitive(health.detail).slice(0, 300), checkedAt: health.checkedAt.toISOString() } : null,
    smoke: smoke ? { outcome: smoke.outcome, checkedAt: smoke.checkedAt.toISOString(), version: smoke.version } : null,
    incidents: issues.map((i) => ({ title: redactSensitive(i.title).slice(0, 120), status: i.status })),
    recurring: topicReviews
      .filter((t) => t.topic && t._count._all >= 2)
      .map((t) => ({ topic: t.topic as string, count: t._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
    knowledge: searchKnowledge(input.body, knowledge, 3).map((d) => ({
      id: d.id,
      title: d.title,
      content: redactSensitive(d.content).slice(0, 500),
    })),
    statusWebhook: webhook,
  };
  return bundle;
}

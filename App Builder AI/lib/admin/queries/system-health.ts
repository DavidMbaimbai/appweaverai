import { prisma } from '@/lib/prisma';
import { isStripeConfigured } from '@/lib/stripe';
import type { DateRange } from '@/lib/admin/queries/dashboard';

export type ComponentHealth = {
  name: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  detail?: string;
  latencyMs?: number;
  checkedAt?: Date;
};

export type ApiPerformanceMetrics = {
  range: DateRange;
  requestCount: number;
  successCount: number;
  failureCount: number;
  errorRatePct: number;
  latencyMs: {
    average: number | null;
    minimum: number | null;
    maximum: number | null;
  };
};

export type DeploymentHealth = {
  range: DateRange;
  total: number;
  failureCount: number;
  statusBreakdown: Array<{
    status: string;
    count: number;
  }>;
  recentFailedDeployments: Array<{
    id: string;
    projectId: string;
    projectName: string;
    status: string;
    deploymentType: string;
    version: number;
    domain: string;
    createdAt: Date;
  }>;
};

export type CriticalErrorFeedItem = {
  id: string;
  type: 'AI_FAILURE' | 'DEPLOYMENT_FAILURE';
  source: string;
  message: string;
  createdAt: Date;
  projectId: string | null;
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Aggregated system health snapshot (ADM-080). Never exposes credentials or
 * connection strings; each dependency is checked with a timeout so one slow
 * dependency cannot block the whole response.
 */
export async function getSystemHealthSnapshot(): Promise<ComponentHealth[]> {
  const checks: Array<Promise<ComponentHealth>> = [
    checkDatabase(),
    checkConfigured('AI Provider (Anthropic)', Boolean(process.env.ANTHROPIC_API_KEY)),
    checkConfigured('Payments (Stripe)', isStripeConfigured()),
    checkConfigured('Authentication', Boolean(process.env.BETTER_AUTH_SECRET)),
  ];

  return Promise.all(checks);
}

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const result = await withTimeout(
      prisma.$queryRaw`SELECT 1`.then(() => true),
      3000,
    );
    const latencyMs = Date.now() - start;
    const checkedAt = new Date();
    if (!result) {
      return {
        name: 'Database',
        status: 'degraded',
        detail: 'Timed out',
        latencyMs,
        checkedAt,
      };
    }
    return { name: 'Database', status: 'healthy', latencyMs, checkedAt };
  } catch {
    return {
      name: 'Database',
      status: 'unavailable',
      detail: 'Connection failed',
      latencyMs: Date.now() - start,
      checkedAt: new Date(),
    };
  }
}

async function checkConfigured(
  name: string,
  configured: boolean,
): Promise<ComponentHealth> {
  return {
    name,
    status: configured ? 'healthy' : 'degraded',
    detail: configured ? undefined : 'Not configured',
    checkedAt: new Date(),
  };
}

/**
 * ADM-082 approximation: the current schema has AI request latency telemetry,
 * but no full-stack API request log/APM table. These metrics therefore reflect
 * AI call performance plus live dependency checks shown elsewhere on the page.
 */
export async function getApiPerformanceMetrics(
  range: DateRange,
): Promise<ApiPerformanceMetrics> {
  const where = { createdAt: { gte: range.from, lte: range.to } };

  const [aggregate, statusBreakdown] = await Promise.all([
    prisma.aiUsageEvent.aggregate({
      where,
      _count: { _all: true },
      _avg: { latencyMs: true },
      _min: { latencyMs: true },
      _max: { latencyMs: true },
    }),
    prisma.aiUsageEvent.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ]);

  const requestCount = aggregate._count._all;
  const failureCount =
    statusBreakdown.find((entry) => entry.status === 'FAILURE')?._count._all ??
    0;
  const successCount =
    statusBreakdown.find((entry) => entry.status === 'SUCCESS')?._count._all ??
    0;

  return {
    range,
    requestCount,
    successCount,
    failureCount,
    errorRatePct:
      requestCount > 0
        ? Math.round((failureCount / requestCount) * 1000) / 10
        : 0,
    latencyMs: {
      average: roundMetric(aggregate._avg.latencyMs),
      minimum: aggregate._min.latencyMs ?? null,
      maximum: aggregate._max.latencyMs ?? null,
    },
  };
}

export async function getDeploymentHealth(
  range: DateRange,
  recentFailedLimit = 10,
): Promise<DeploymentHealth> {
  const where = { createdAt: { gte: range.from, lte: range.to } };
  const boundedRecentFailedLimit = Math.max(1, Math.min(recentFailedLimit, 50));

  const [statusBreakdown, recentFailedDeployments] = await Promise.all([
    prisma.deployment.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
    prisma.deployment.findMany({
      where: {
        ...where,
        status: 'FAILED',
      },
      orderBy: { createdAt: 'desc' },
      take: boundedRecentFailedLimit,
      select: {
        id: true,
        version: true,
        status: true,
        deploymentType: true,
        domain: true,
        createdAt: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const total = statusBreakdown.reduce((sum, entry) => sum + entry._count._all, 0);
  const failureCount =
    statusBreakdown.find((entry) => entry.status === 'FAILED')?._count._all ?? 0;

  return {
    range,
    total,
    failureCount,
    statusBreakdown: statusBreakdown.map((entry) => ({
      status: entry.status,
      count: entry._count._all,
    })),
    recentFailedDeployments: recentFailedDeployments.map((deployment) => ({
      id: deployment.id,
      projectId: deployment.project.id,
      projectName: deployment.project.name,
      status: deployment.status,
      deploymentType: deployment.deploymentType,
      version: deployment.version,
      domain: deployment.domain,
      createdAt: deployment.createdAt,
    })),
  };
}

export async function getCriticalErrorFeed(
  limit = 20,
): Promise<CriticalErrorFeedItem[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const sourceTake = Math.max(boundedLimit * 2, 20);
  const recentWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [aiFailures, deploymentFailures] = await Promise.all([
    prisma.aiUsageEvent.findMany({
      where: {
        status: 'FAILURE',
        createdAt: { gte: recentWindowStart },
      },
      orderBy: { createdAt: 'desc' },
      take: sourceTake,
      select: {
        id: true,
        provider: true,
        model: true,
        errorCategory: true,
        createdAt: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.deployment.findMany({
      where: {
        status: 'FAILED',
        createdAt: { gte: recentWindowStart },
      },
      orderBy: { createdAt: 'desc' },
      take: sourceTake,
      select: {
        id: true,
        version: true,
        deploymentType: true,
        domain: true,
        createdAt: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return [
    ...aiFailures.map<CriticalErrorFeedItem>((event) => ({
      id: event.id,
      type: 'AI_FAILURE',
      source: `${event.provider} / ${event.model}`,
      message: event.errorCategory ?? 'Uncategorized AI provider failure',
      createdAt: event.createdAt,
      projectId: event.project?.id ?? null,
    })),
    ...deploymentFailures.map<CriticalErrorFeedItem>((deployment) => ({
      id: deployment.id,
      type: 'DEPLOYMENT_FAILURE',
      source: deployment.project.name,
      message: `Deployment v${deployment.version} (${formatDeploymentType(deployment.deploymentType)}) failed for ${deployment.domain}`,
      createdAt: deployment.createdAt,
      projectId: deployment.project.id,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, boundedLimit);
}

function roundMetric(value: number | null) {
  return value == null ? null : Math.round(value * 10) / 10;
}

function formatDeploymentType(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

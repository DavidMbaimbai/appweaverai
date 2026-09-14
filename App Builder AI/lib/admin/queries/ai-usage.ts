import type { Prisma } from '@/lib/generated/prisma/client';

import { prisma } from '@/lib/prisma';

import type { DateRange } from './dashboard';

const MAX_BREAKDOWN_ROWS = 50;
const MAX_FILTER_OPTIONS = 100;
const MAX_PLAN_ACTIVITY_USERS = 500;

export const AI_USAGE_LIMIT_PLANS = ['free', 'pro'] as const;

export type AiLimitPlan = (typeof AI_USAGE_LIMIT_PLANS)[number];

export type AiLimitSettingValue = {
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  monthlyCostCentsLimit: number;
};

export type AiUsageFilters = {
  provider?: string;
  model?: string;
};

export const EMPTY_AI_LIMIT_SETTING: AiLimitSettingValue = {
  dailyRequestLimit: 0,
  dailyTokenLimit: 0,
  monthlyCostCentsLimit: 0,
};

export function getAiLimitSettingKey(plan: AiLimitPlan) {
  return `ai_limits.plan.${plan}`;
}

export function validateAiLimitSetting(
  value: unknown,
): { ok: true; value: AiLimitSettingValue } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Limits payload is required.' };
  }

  const candidate = value as Partial<Record<keyof AiLimitSettingValue, unknown>>;
  const dailyRequestLimit = parseNonNegativeInteger(
    candidate.dailyRequestLimit,
    'Daily request limit',
  );
  if (typeof dailyRequestLimit === 'string') {
    return { ok: false, error: dailyRequestLimit };
  }

  const dailyTokenLimit = parseNonNegativeInteger(
    candidate.dailyTokenLimit,
    'Daily token limit',
  );
  if (typeof dailyTokenLimit === 'string') {
    return { ok: false, error: dailyTokenLimit };
  }

  const monthlyCostCentsLimit = parseNonNegativeInteger(
    candidate.monthlyCostCentsLimit,
    'Monthly cost limit',
  );
  if (typeof monthlyCostCentsLimit === 'string') {
    return { ok: false, error: monthlyCostCentsLimit };
  }

  return {
    ok: true,
    value: {
      dailyRequestLimit,
      dailyTokenLimit,
      monthlyCostCentsLimit,
    },
  };
}

export function parseAiLimitSetting(
  value: unknown,
): AiLimitSettingValue | null {
  const parsed = validateAiLimitSetting(value);
  return parsed.ok ? parsed.value : null;
}

export async function getAiUsageFilterOptions(
  range: DateRange,
  selectedProvider?: string,
) {
  const baseWhere = buildAiUsageWhere(range);
  const modelWhere = buildAiUsageWhere(range, { provider: selectedProvider });

  const [providers, models] = await Promise.all([
    prisma.aiUsageEvent.groupBy({
      by: ['provider'],
      where: baseWhere,
      orderBy: { provider: 'asc' },
      take: MAX_FILTER_OPTIONS,
    }),
    prisma.aiUsageEvent.groupBy({
      by: ['model'],
      where: modelWhere,
      orderBy: { model: 'asc' },
      take: MAX_FILTER_OPTIONS,
    }),
  ]);

  return {
    providers: providers.map((entry) => entry.provider),
    models: models.map((entry) => entry.model),
  };
}

export async function getAiUsageDashboard(
  range: DateRange,
  filters: AiUsageFilters = {},
) {
  const where = buildAiUsageWhere(range, filters);

  const [summary, statusGroups, breakdownGroups, filterOptions] =
    await Promise.all([
      prisma.aiUsageEvent.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          estimatedCostCents: true,
        },
        _avg: { latencyMs: true },
      }),
      prisma.aiUsageEvent.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      prisma.aiUsageEvent.groupBy({
        by: ['provider', 'model'],
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          estimatedCostCents: true,
        },
        _avg: { latencyMs: true },
        orderBy: {
          _sum: { estimatedCostCents: 'desc' },
        },
        take: MAX_BREAKDOWN_ROWS,
      }),
      getAiUsageFilterOptions(range, filters.provider),
    ]);

  const successCount =
    statusGroups.find((group) => group.status === 'SUCCESS')?._count._all ?? 0;
  const failureCount =
    statusGroups.find((group) => group.status === 'FAILURE')?._count._all ?? 0;

  const statusBreakdowns = breakdownGroups.length
    ? await prisma.aiUsageEvent.groupBy({
        by: ['provider', 'model', 'status'],
        where: {
          ...where,
          OR: breakdownGroups.map((group) => ({
            provider: group.provider,
            model: group.model,
          })),
        },
        _count: { _all: true },
      })
    : [];

  const statusMap = new Map(
    statusBreakdowns.map((group) => [
      buildProviderModelStatusKey(group.provider, group.model, group.status),
      group._count._all,
    ]),
  );

  return {
    filters,
    availableProviders: filterOptions.providers,
    availableModels: filterOptions.models,
    summary: {
      totalRequests: summary._count._all,
      successfulRequests: successCount,
      failedRequests: failureCount,
      inputTokens: summary._sum.inputTokens ?? 0,
      outputTokens: summary._sum.outputTokens ?? 0,
      totalTokens: sumTokens(summary._sum.inputTokens, summary._sum.outputTokens),
      totalCostCents: summary._sum.estimatedCostCents ?? 0,
      averageLatencyMs:
        summary._avg.latencyMs != null
          ? Math.round(summary._avg.latencyMs)
          : null,
      successRatePct: toPercent(successCount, summary._count._all),
    },
    breakdown: breakdownGroups.map((group) => {
      const successfulRequests =
        statusMap.get(
          buildProviderModelStatusKey(group.provider, group.model, 'SUCCESS'),
        ) ?? 0;
      const failedRequests =
        statusMap.get(
          buildProviderModelStatusKey(group.provider, group.model, 'FAILURE'),
        ) ?? 0;

      return {
        provider: group.provider,
        model: group.model,
        requests: group._count._all,
        successfulRequests,
        failedRequests,
        inputTokens: group._sum.inputTokens ?? 0,
        outputTokens: group._sum.outputTokens ?? 0,
        totalTokens: sumTokens(group._sum.inputTokens, group._sum.outputTokens),
        totalCostCents: group._sum.estimatedCostCents ?? 0,
        averageLatencyMs:
          group._avg.latencyMs != null
            ? Math.round(group._avg.latencyMs)
            : null,
        successRatePct: toPercent(successfulRequests, group._count._all),
      };
    }),
  };
}

export async function getAiUsageByUser(
  range: DateRange,
  filters: AiUsageFilters = {},
) {
  const where = buildAiUsageWhere(range, filters);
  const groups = await prisma.aiUsageEvent.groupBy({
    by: ['userId'],
    where,
    _count: { _all: true },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      estimatedCostCents: true,
    },
    orderBy: {
      _sum: { estimatedCostCents: 'desc' },
    },
    take: MAX_BREAKDOWN_ROWS,
  });

  const userIds = groups
    .map((group) => group.userId)
    .filter((userId): userId is string => Boolean(userId));

  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          subscriptionPlan: true,
          creditBalance: true,
        },
      })
    : [];

  const userMap = new Map(users.map((user) => [user.id, user]));

  return groups.map((group) => {
    const user = group.userId ? userMap.get(group.userId) : null;

    return {
      userId: group.userId,
      href: group.userId ? `/admin/users/${group.userId}` : null,
      name:
        user?.name ?? user?.username ?? user?.email ?? 'Anonymous / deleted user',
      email: user?.email ?? null,
      subscriptionPlan: user?.subscriptionPlan ?? null,
      creditBalance: user?.creditBalance ?? null,
      requests: group._count._all,
      inputTokens: group._sum.inputTokens ?? 0,
      outputTokens: group._sum.outputTokens ?? 0,
      totalTokens: sumTokens(group._sum.inputTokens, group._sum.outputTokens),
      totalCostCents: group._sum.estimatedCostCents ?? 0,
    };
  });
}

export async function getAiUsageByProject(
  range: DateRange,
  filters: AiUsageFilters = {},
) {
  const where = buildAiUsageWhere(range, filters);
  const groups = await prisma.aiUsageEvent.groupBy({
    by: ['projectId'],
    where,
    _count: { _all: true },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      estimatedCostCents: true,
    },
    orderBy: {
      _sum: { estimatedCostCents: 'desc' },
    },
    take: MAX_BREAKDOWN_ROWS,
  });

  const projectIds = groups
    .map((group) => group.projectId)
    .filter((projectId): projectId is string => Boolean(projectId));

  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      })
    : [];

  const projectMap = new Map(projects.map((project) => [project.id, project]));

  return groups.map((group) => {
    const project = group.projectId ? projectMap.get(group.projectId) : null;

    return {
      projectId: group.projectId,
      href: group.projectId ? `/admin/projects/${group.projectId}` : null,
      name: project?.name ?? 'Unattributed / deleted project',
      slug: project?.slug ?? null,
      requests: group._count._all,
      inputTokens: group._sum.inputTokens ?? 0,
      outputTokens: group._sum.outputTokens ?? 0,
      totalTokens: sumTokens(group._sum.inputTokens, group._sum.outputTokens),
      totalCostCents: group._sum.estimatedCostCents ?? 0,
    };
  });
}

export async function getAiUsageByPlan(
  range: DateRange,
  filters: AiUsageFilters = {},
) {
  const where = buildAiUsageWhere(range, filters);

  // Bounded two-step rollup until telemetry stores subscription plan directly.
  // Revenue / cost ratio is intentionally omitted here for MVP because the
  // selected date range reflects usage activity, while subscription revenue is
  // billed on a different cadence and is not directly attributable from this
  // telemetry query without additional product-specific accounting rules.
  const userGroups = await prisma.aiUsageEvent.groupBy({
    by: ['userId'],
    where: {
      ...where,
      userId: { not: null },
    },
    _count: { _all: true },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      estimatedCostCents: true,
    },
    orderBy: {
      _sum: { estimatedCostCents: 'desc' },
    },
    take: MAX_PLAN_ACTIVITY_USERS,
  });

  const userIds = userGroups
    .map((group) => group.userId)
    .filter((userId): userId is string => Boolean(userId));

  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          subscriptionPlan: true,
        },
      })
    : [];

  const userPlanMap = new Map(users.map((user) => [user.id, user.subscriptionPlan]));
  const planMap = new Map<
    string,
    {
      plan: string;
      activeUsers: number;
      requests: number;
      totalTokens: number;
      totalCostCents: number;
    }
  >();

  for (const group of userGroups) {
    if (!group.userId) continue;

    const plan = userPlanMap.get(group.userId) ?? 'unknown';
    const current = planMap.get(plan) ?? {
      plan,
      activeUsers: 0,
      requests: 0,
      totalTokens: 0,
      totalCostCents: 0,
    };

    current.activeUsers += 1;
    current.requests += group._count._all;
    current.totalTokens += sumTokens(
      group._sum.inputTokens,
      group._sum.outputTokens,
    );
    current.totalCostCents += group._sum.estimatedCostCents ?? 0;
    planMap.set(plan, current);
  }

  return {
    cappedUserCount: MAX_PLAN_ACTIVITY_USERS,
    plans: Array.from(planMap.values())
      .map((plan) => ({
        ...plan,
        averageCostCentsPerActiveUser:
          plan.activeUsers > 0
            ? Math.round(plan.totalCostCents / plan.activeUsers)
            : 0,
      }))
      .sort((a, b) => b.totalCostCents - a.totalCostCents),
  };
}

export async function getAiUsageLimitSettings() {
  const keys = AI_USAGE_LIMIT_PLANS.map(getAiLimitSettingKey);
  const settings = await prisma.adminSetting.findMany({
    where: { key: { in: keys } },
    orderBy: { key: 'asc' },
  });

  const settingMap = new Map(settings.map((setting) => [setting.key, setting]));

  return AI_USAGE_LIMIT_PLANS.map((plan) => {
    const setting = settingMap.get(getAiLimitSettingKey(plan));

    return {
      plan,
      key: getAiLimitSettingKey(plan),
      value: parseAiLimitSetting(setting?.value) ?? EMPTY_AI_LIMIT_SETTING,
      updatedAt: setting?.updatedAt ?? null,
      updatedById: setting?.updatedById ?? null,
    };
  });
}

function buildAiUsageWhere(
  range: DateRange,
  filters: AiUsageFilters = {},
): Prisma.AiUsageEventWhereInput {
  const where: Prisma.AiUsageEventWhereInput = {
    createdAt: {
      gte: range.from,
      lte: range.to,
    },
  };

  if (filters.provider) {
    where.provider = filters.provider;
  }

  if (filters.model) {
    where.model = filters.model;
  }

  return where;
}

function buildProviderModelStatusKey(
  provider: string,
  model: string,
  status: 'SUCCESS' | 'FAILURE',
) {
  return `${provider}::${model}::${status}`;
}

function parseNonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return `${label} must be a non-negative whole number.`;
  }

  return value;
}

function sumTokens(inputTokens: number | null, outputTokens: number | null) {
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function toPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

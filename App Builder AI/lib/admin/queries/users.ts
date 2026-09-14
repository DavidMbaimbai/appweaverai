import { prisma } from '@/lib/prisma';

export type UserListFilters = {
  search?: string;
  status?: string;
  plan?: string;
  page?: number;
  pageSize?: number;
};

export async function listUsers(filters: UserListFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;

  const where: Record<string, unknown> = {};

  if (filters.search) {
    where.OR = [
      { id: filters.search },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { name: { contains: filters.search, mode: 'insensitive' } },
      { username: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  if (filters.status) {
    where.accountStatus = filters.status;
  }

  if (filters.plan) {
    where.subscriptionPlan = filters.plan;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        accountStatus: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        adminRole: true,
        createdAt: true,
        _count: { select: { createdProjects: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page, pageSize };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      _count: {
        select: { createdProjects: true, sessions: true },
      },
      creditAdjustments: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      flags: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      sessions: {
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
        },
      },
    },
  });

  if (!user) return null;

  const [aiUsage, recentProjects] = await Promise.all([
    prisma.aiUsageEvent.aggregate({
      where: { userId },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostCents: true },
    }),
    prisma.project.findMany({
      where: { createdById: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, slug: true, updatedAt: true, adminStatus: true },
    }),
  ]);

  return { user, aiUsage, recentProjects };
}

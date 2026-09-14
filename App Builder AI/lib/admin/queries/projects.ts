import { prisma } from '@/lib/prisma';
import type {
  DeploymentStatus,
  Prisma,
  ProjectAdminStatus,
} from '@/lib/generated/prisma/client';

const PAGE_SIZE = 25;
const DEPLOYMENT_PAGE_SIZE = 50;

const PROJECT_STATUS_VALUES = new Set<ProjectAdminStatus>([
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
]);

export type ProjectListFilters = {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function listProjects(filters: ProjectListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? PAGE_SIZE;
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
  };

  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { id: search },
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
      {
        createdBy: {
          is: {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { username: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      },
    ];
  }

  if (filters.status && PROJECT_STATUS_VALUES.has(filters.status as ProjectAdminStatus)) {
    where.adminStatus = filters.status as ProjectAdminStatus;
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        adminStatus: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
          },
        },
      },
    }),
    prisma.project.count({ where }),
  ]);

  const projectIds = projects.map((project) => project.id);
  const usageByProject =
    projectIds.length > 0
      ? await prisma.aiUsageEvent.groupBy({
          by: ['projectId'],
          where: {
            projectId: { in: projectIds },
          },
          _sum: {
            estimatedCostCents: true,
          },
        })
      : [];

  const costByProjectId = new Map(
    usageByProject
      .filter((item) => item.projectId)
      .map((item) => [item.projectId as string, item._sum.estimatedCostCents ?? 0]),
  );

  return {
    projects: projects.map((project) => ({
      ...project,
      aiCostCents: costByProjectId.get(project.id) ?? 0,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getProjectDetail(
  projectId: string,
  options?: { deployments?: 'all' | 'failed' },
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      adminStatus: true,
      suspendedReason: true,
      suspendedAt: true,
      suspendedById: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          accountStatus: true,
        },
      },
      deployments: {
        where: { isCurrent: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          deploymentType: true,
          visibility: true,
          domain: true,
          customDomain: true,
          isCurrent: true,
          publishedAt: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          deployments: true,
          aiUsageEvents: true,
          artifacts: true,
          files: true,
          flags: true,
        },
      },
    },
  });

  if (!project) return null;

  const deploymentWhere: Prisma.DeploymentWhereInput = {
    projectId,
    ...(options?.deployments === 'failed'
      ? ({ status: 'FAILED' satisfies DeploymentStatus } as const)
      : {}),
  };

  const [aiUsage, deployments] = await Promise.all([
    prisma.aiUsageEvent.aggregate({
      where: { projectId },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        estimatedCostCents: true,
      },
    }),
    prisma.deployment.findMany({
      where: deploymentWhere,
      orderBy: { createdAt: 'desc' },
      take: DEPLOYMENT_PAGE_SIZE,
      select: {
        id: true,
        version: true,
        status: true,
        deploymentType: true,
        visibility: true,
        domain: true,
        customDomain: true,
        isCurrent: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    project,
    aiUsage,
    deployments,
    currentDeployment: project.deployments[0] ?? null,
  };
}

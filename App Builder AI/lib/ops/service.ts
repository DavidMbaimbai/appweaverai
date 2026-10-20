import { getProjectCustomDomain } from '@/lib/domains/custom-domain';
import { getProjectSubdomain } from '@/lib/domains/subdomain-store';
import { getHealthHistory } from '@/lib/hosting/health';
import { stagingPath } from '@/lib/hosting/staging';
import { prisma } from '@/lib/prisma';
import { listProjectCheckpoints } from '@/lib/project-checkpoints';
import { getProjectGithubLink } from '@/lib/project-github-export';
import { projectAccessWhere, projectOwnerAccessOr } from '@/lib/projects/access';
import { publishedPath } from '@/lib/publish/visibility';

import { deploymentDurationMs } from './aggregate';

export const OPS_CHART_WINDOW_DAYS = 56;
const HISTORY_LIMIT = 50;
const CHART_LIMIT = 1000;

export type OpsAccess = { member: boolean; owner: boolean };

/** Members may read; only owners (workspace owner or the project creator with access) may mutate. */
export async function getOpsAccess(projectId: string, userId: string): Promise<OpsAccess> {
  const [member, owner] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, ...projectAccessWhere(userId) },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { id: projectId, deletedAt: null, OR: projectOwnerAccessOr(userId) },
      select: { id: true },
    }),
  ]);
  return { member: Boolean(member), owner: Boolean(owner) };
}

export type OpsChartPoint = {
  status: string;
  environment: 'PRODUCTION' | 'STAGING';
  createdAt: string;
};

export type OpsDeploymentRow = {
  id: string;
  version: number;
  status: string;
  environment: 'PRODUCTION' | 'STAGING';
  isLive: boolean;
  promotedFromVersion: number | null;
  visibility: string;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
  durationMs: number | null;
  createdByName: string | null;
  canRollback: boolean;
};

/** Deployments for one project only; the projectId predicate is the tenant boundary. */
export async function getDeploymentData(projectId: string, now = new Date()) {
  const since = new Date(now.getTime() - OPS_CHART_WINDOW_DAYS * 86_400_000);
  const [points, history] = await Promise.all([
    prisma.deployment.findMany({
      where: { projectId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: CHART_LIMIT,
      select: { status: true, environment: true, createdAt: true },
    }),
    prisma.deployment.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        version: true,
        status: true,
        environment: true,
        isCurrent: true,
        promotedFromVersion: true,
        visibility: true,
        createdAt: true,
        publishedAt: true,
        updatedAt: true,
        createdBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  return {
    chartPoints: points.map<OpsChartPoint>((p) => ({
      status: p.status,
      environment: p.environment,
      createdAt: p.createdAt.toISOString(),
    })),
    history: history.map<OpsDeploymentRow>((d) => {
      const isLive = d.environment === 'STAGING' ? d.status === 'LIVE' : d.isCurrent;
      return {
        id: d.id,
        version: d.version,
        status: d.status,
        environment: d.environment,
        isLive,
        promotedFromVersion: d.promotedFromVersion,
        visibility: d.visibility,
        createdAt: d.createdAt.toISOString(),
        publishedAt: d.publishedAt?.toISOString() ?? null,
        updatedAt: d.updatedAt.toISOString(),
        durationMs: deploymentDurationMs(d),
        createdByName: d.createdBy.name ?? d.createdBy.email,
        // Final eligibility (stored files) is re-checked by the rollback action.
        canRollback: !isLive && d.status !== 'FAILED',
      };
    }),
  };
}

export type OpsEnvironmentRow = {
  key: 'production' | 'staging' | 'preview';
  label: string;
  available: boolean;
  note: string | null;
  status: string;
  version: number | null;
  url: string | null;
  publishedAt: string | null;
  envVarCount: number | null;
};

export async function getOperationsData(projectId: string, origin: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      slug: true,
      workspace: { select: { slug: true } },
      artifacts: { select: { slug: true, name: true } },
    },
  });

  const [
    deployments,
    secretCounts,
    health,
    customDomain,
    subdomain,
    checkpoints,
    githubLink,
    databases,
  ] = await Promise.all([
    getDeploymentData(projectId),
    prisma.projectSecret.groupBy({
      by: ['environment'],
      where: { projectId },
      _count: { _all: true },
    }),
    getHealthHistory(projectId),
    getProjectCustomDomain(projectId),
    getProjectSubdomain(projectId),
    listProjectCheckpoints(projectId),
    getProjectGithubLink(projectId),
    prisma.projectDatabase.findMany({
      where: { projectId },
      select: { environment: true, provider: true, databaseName: true, isActive: true, createdAt: true },
    }),
  ]);

  const counts = new Map(secretCounts.map((row) => [row.environment, row._count._all]));
  const liveProd = deployments.history.find((d) => d.environment === 'PRODUCTION' && d.isLive);
  const liveStaging = deployments.history.find((d) => d.environment === 'STAGING' && d.isLive);
  const latestProd = deployments.history.find((d) => d.environment === 'PRODUCTION');

  const environments: OpsEnvironmentRow[] = [
    {
      key: 'production',
      label: 'Production',
      available: true,
      note: null,
      status: liveProd ? 'LIVE' : (latestProd?.status ?? 'NOT_DEPLOYED'),
      version: liveProd?.version ?? null,
      url: liveProd ? `${origin}${publishedPath(project.workspace.slug, project.slug)}` : null,
      publishedAt: liveProd?.publishedAt ?? null,
      envVarCount: counts.get('PRODUCTION') ?? 0,
    },
    {
      key: 'staging',
      label: 'Staging',
      available: true,
      note: null,
      status: liveStaging ? 'LIVE' : 'NOT_DEPLOYED',
      version: liveStaging?.version ?? null,
      url: liveStaging ? `${origin}${stagingPath(project.workspace.slug, project.slug)}` : null,
      publishedAt: liveStaging?.publishedAt ?? null,
      envVarCount: counts.get('STAGING') ?? 0,
    },
    {
      key: 'preview',
      label: 'Preview',
      available: false,
      note: 'Preview deployments are not tracked as separate deployments; the editor preview is not recorded here.',
      status: 'NOT_AVAILABLE',
      version: null,
      url: null,
      publishedAt: null,
      envVarCount: counts.get('DEVELOPMENT') ?? 0,
    },
  ];

  return {
    deployments,
    environments,
    health,
    domains: {
      subdomain: subdomain?.host ?? null,
      custom: customDomain
        ? { domain: customDomain.domain, verified: Boolean(customDomain.verifiedAt) }
        : null,
    },
    versions: { checkpoints, artifacts: project.artifacts },
    github: githubLink
      ? { ...githubLink, lastSyncedAt: githubLink.lastSyncedAt?.toISOString() ?? null }
      : null,
    databases: databases.map((db) => ({
      environment: db.environment,
      provider: db.provider,
      databaseName: db.databaseName,
      isActive: db.isActive,
      createdAt: db.createdAt.toISOString(),
    })),
  };
}

export type OperationsData = Awaited<ReturnType<typeof getOperationsData>>;

import { prisma } from '@/lib/prisma';
import { getProjectSubdomain } from '@/lib/domains/subdomain-store';
import { stagingHost } from '@/lib/domains/subdomain';
import { hasProjectAccess } from '@/lib/projects/access';
import { publishedPath } from '@/lib/publish/visibility';

import {
  decideStagingAccess,
  STAGING_TOKEN_PARAM,
  type StagingAccess,
} from './staging-core';

/** Path-based staging URL, e.g. /p/acme/my-site/staging. */
export function stagingPath(workspaceSlug: string, projectSlug: string) {
  return `${publishedPath(workspaceSlug, projectSlug)}/staging`;
}

export async function getLiveStagingDeployment(projectId: string) {
  return prisma.deployment.findFirst({
    where: { projectId, environment: 'STAGING', status: 'LIVE' },
    select: {
      id: true,
      version: true,
      visibility: true,
      accessToken: true,
      publishedAt: true,
      createdAt: true,
    },
  });
}

export async function getLiveProductionDeployment(projectId: string) {
  return prisma.deployment.findFirst({
    where: { projectId, environment: 'PRODUCTION', isCurrent: true },
    select: {
      id: true,
      version: true,
      status: true,
      visibility: true,
      promotedFromVersion: true,
      publishedAt: true,
      createdAt: true,
    },
  });
}

export function appendToken(url: string, token: string | null) {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${STAGING_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** Staging for a managed subdomain's project, used by proxy.ts via /api/domains/resolve. */
export async function resolveStagingPathForLabel(label: string) {
  const record = await prisma.projectSubdomain.findUnique({
    where: { subdomain: label.toLowerCase() },
    select: { projectId: true },
  });
  if (!record) return null;

  const project = await prisma.project.findUnique({
    where: { id: record.projectId },
    select: {
      slug: true,
      deletedAt: true,
      adminStatus: true,
      workspace: { select: { slug: true } },
      deployments: {
        where: { environment: 'STAGING', status: 'LIVE' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (
    !project ||
    project.deletedAt ||
    project.adminStatus !== 'ACTIVE' ||
    project.deployments.length === 0
  ) {
    return null;
  }
  return stagingPath(project.workspace.slug, project.slug);
}

export async function getStagingUrls(
  projectId: string,
  workspaceSlug: string,
  projectSlug: string,
  token: string | null,
  origin: string,
) {
  const subdomain = await getProjectSubdomain(projectId);
  const pathUrl = `${origin}${stagingPath(workspaceSlug, projectSlug)}`;
  const hostUrl = subdomain
    ? `https://${stagingHost(subdomain.subdomain)}`
    : null;
  return {
    path: appendToken(pathUrl, token),
    host: hostUrl ? appendToken(hostUrl, token) : null,
  };
}

/** Project members always pass; everyone else needs the share token (if one is set). */
export async function authorizeStagingAccess(
  projectId: string,
  userId: string | null,
  tokens: { query?: string | null; cookie?: string | null },
): Promise<StagingAccess & { deploymentFound: boolean }> {
  const deployment = await getLiveStagingDeployment(projectId);
  if (!deployment) return { allowed: false, deploymentFound: false };

  const isMember = userId ? await hasProjectAccess(projectId, userId) : false;
  const access = decideStagingAccess({
    deploymentToken: deployment.accessToken,
    queryToken: tokens.query,
    cookieToken: tokens.cookie,
    isMember,
  });
  return { ...access, deploymentFound: true };
}

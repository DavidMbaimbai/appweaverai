'use server';

import { revalidatePath } from 'next/cache';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { getCachedSession } from '@/lib/auth/cached';
import {
  canPublishVisibility,
  FREE_PRIVATE_DEPLOYMENT_LIMIT,
  getAppTier,
  publishUpgradeMessage,
} from '@/lib/billing/entitlements';
import { getHostingLimits } from '@/lib/hosting/limits';
import {
  getLiveProductionDeployment,
  getLiveStagingDeployment,
  getStagingUrls,
  stagingPath,
} from '@/lib/hosting/staging';
import { generateStagingToken, planPromotion } from '@/lib/hosting/staging-core';
import { evaluatePublishGate, formatGateError } from '@/lib/launch-readiness/service';
import { appOrigin } from '@/lib/observatory/smoke';
import { prisma } from '@/lib/prisma';
import { getAccessibleProject } from '@/lib/projects/access';
import { getUserBillingFields } from '@/lib/queries/billing';
import {
  publishedPath,
  toDeploymentVisibility,
  type PublishVisibility,
} from '@/lib/publish/visibility';
import { snapshotArtifactForPublish } from '@/lib/publish/snapshot';
import {
  enforceDeploymentRetention,
  hasVersionSnapshot,
  restoreVersionSnapshot,
  saveVersionSnapshot,
} from '@/lib/publish/versions';
import { refreshFeatureLedger } from '@/lib/observatory/understand';
import { captureProjectScreenshots } from '@/lib/gallery/capture-screenshot';

async function authorize(projectId: string) {
  const fail = (error: string): { error: string } => ({ error });
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return fail('You must be signed in.');
  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    slug: true,
    workspace: { select: { slug: true } },
    artifacts: { select: { id: true, slug: true } },
  });
  if (!project) return fail('Project not found.');
  const ok: { userId: string; project: typeof project } = { userId, project };
  return ok;
}

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === 'P2002';

export type EnvironmentsOverview = {
  staging: {
    version: number;
    publishedAt: string | null;
    protected: boolean;
    pathUrl: string;
    hostUrl: string | null;
  } | null;
  production: {
    version: number;
    visibility: PublishVisibility;
    publishedAt: string | null;
    promotedFromVersion: number | null;
    url: string;
  } | null;
};

export async function getEnvironmentsOverviewAction(
  projectId: string,
): Promise<EnvironmentsOverview | { error: string }> {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  const { project } = auth;

  const [staging, production] = await Promise.all([
    getLiveStagingDeployment(projectId),
    getLiveProductionDeployment(projectId),
  ]);
  const urls = staging
    ? await getStagingUrls(projectId, project.workspace.slug, project.slug, staging.accessToken, appOrigin())
    : null;

  return {
    staging:
      staging && urls
        ? {
            version: staging.version,
            publishedAt: staging.publishedAt?.toISOString() ?? null,
            protected: Boolean(staging.accessToken),
            pathUrl: urls.path,
            hostUrl: urls.host,
          }
        : null,
    production: production
      ? {
          version: production.version,
          visibility: (
            { PRIVATE: 'private', WORKSPACE_ONLY: 'workspace', PUBLIC: 'public' } as const
          )[production.visibility],
          publishedAt: production.publishedAt?.toISOString() ?? null,
          promotedFromVersion: production.promotedFromVersion,
          url: publishedPath(project.workspace.slug, project.slug),
        }
      : null,
  };
}

async function activateStagingRow(
  projectId: string,
  userId: string,
  workspaceSlug: string,
  projectSlug: string,
  artifactSlugs: string[],
  accessToken: string | null,
  tier: ReturnType<typeof getAppTier>,
) {
  const latest = await prisma.deployment.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.deployment.updateMany({
        where: { projectId, environment: 'STAGING', status: 'LIVE' },
        data: { status: 'SUPERSEDED' },
      });
      await tx.deployment.create({
        data: {
          projectId,
          version,
          environment: 'STAGING',
          status: 'LIVE',
          visibility: 'PRIVATE',
          domain: stagingPath(workspaceSlug, projectSlug),
          isCurrent: false,
          accessToken,
          createdById: userId,
          publishedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: 'Another staging publish is in progress. Try again.' as const };
    }
    throw error;
  }
  await saveVersionSnapshot(projectId, version, artifactSlugs, 'STAGING')
    .then(() => enforceDeploymentRetention(projectId, getHostingLimits(tier).deploymentsRetained))
    .catch(() => null);
  return { version };
}

/** Publishes the current files to staging (never touches production). */
export async function publishToStagingAction(projectId: string) {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  const { userId, project } = auth;

  if (project.artifacts.length === 0) return { error: 'Build your project before publishing.' };

  const results = await Promise.allSettled(
    project.artifacts.map((a) => snapshotArtifactForPublish(projectId, a.slug, 'STAGING')),
  );
  if (
    results.some(
      (r) => r.status === 'rejected' && (r.reason as NodeJS.ErrnoException)?.code !== 'ENOENT',
    )
  ) {
    return { error: 'Publishing to staging failed while saving your site. Please try again.' };
  }

  const previous = await prisma.deployment.findFirst({
    where: { projectId, environment: 'STAGING' },
    orderBy: { version: 'desc' },
    select: { accessToken: true },
  });
  // Keep the owner's choice (protected or open) across staging publishes.
  const accessToken = previous ? previous.accessToken : generateStagingToken();
  const tier = getAppTier(await getUserBillingFields(userId));

  const out = await activateStagingRow(
    projectId,
    userId,
    project.workspace.slug,
    project.slug,
    project.artifacts.map((a) => a.slug),
    accessToken,
    tier,
  );
  if ('error' in out) return out;

  await recordUserActivity({
    userId,
    action: 'project.published_staging',
    targetType: 'Project',
    targetId: projectId,
    after: { version: out.version },
  });
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);

  const urls = await getStagingUrls(projectId, project.workspace.slug, project.slug, accessToken, appOrigin());
  return { success: true as const, version: out.version, urls };
}

/** Promotes live staging to production by copying its stored files; no rebuild. */
export async function promoteStagingToProductionAction(
  projectId: string,
  visibility: PublishVisibility,
) {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  const { userId, project } = auth;

  if (!['private', 'workspace', 'public'].includes(visibility)) {
    return { error: 'Invalid visibility.' };
  }
  const user = await getUserBillingFields(userId);
  if (!user) return { error: 'User not found.' };
  const tier = getAppTier(user);
  if (!canPublishVisibility(tier, visibility)) {
    return { error: publishUpgradeMessage(visibility) };
  }

  const [staging, production, latest] = await Promise.all([
    getLiveStagingDeployment(projectId),
    getLiveProductionDeployment(projectId),
    prisma.deployment.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    }),
  ]);

  const plan = planPromotion({
    staging: staging ? { version: staging.version, visibility: staging.visibility } : null,
    production: production
      ? {
          version: production.version,
          visibility: production.visibility,
          promotedFromVersion: production.promotedFromVersion,
        }
      : null,
    latestVersion: latest?.version ?? 0,
    stagingSnapshotExists: staging ? await hasVersionSnapshot(projectId, staging.version) : false,
    productionVisibility: toDeploymentVisibility(visibility),
  });
  if (!plan.ok) return { error: plan.error };

  const gate = await evaluatePublishGate(projectId, 'STAGING');
  if (gate.blocked) return { error: formatGateError(gate), launchBlocked: true as const };

  if (tier === 'free' && visibility === 'private') {
    const others = await prisma.deployment.count({
      where: {
        status: 'LIVE',
        visibility: 'PRIVATE',
        environment: 'PRODUCTION',
        projectId: { not: projectId },
        project: {
          deletedAt: null,
          OR: [{ createdById: userId }, { workspace: { ownerId: userId } }],
        },
      },
    });
    if (others >= FREE_PRIVATE_DEPLOYMENT_LIMIT) {
      return {
        error: 'Free plan allows one privately published project. Upgrade to Pro to publish more.',
      };
    }
  }

  try {
    await restoreVersionSnapshot(projectId, plan.sourceVersion, 'PRODUCTION');
  } catch {
    return { error: 'Promoting failed while copying the staging files. Please try again.' };
  }

  const urlPath = publishedPath(project.workspace.slug, project.slug);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.deployment.updateMany({
        where: { projectId, environment: 'PRODUCTION', isCurrent: true },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      await tx.deployment.create({
        data: {
          projectId,
          version: plan.newVersion,
          environment: 'PRODUCTION',
          status: 'LIVE',
          visibility: toDeploymentVisibility(visibility),
          domain: urlPath,
          isCurrent: true,
          promotedFromVersion: plan.sourceVersion,
          createdById: userId,
          publishedAt: new Date(),
        },
      });
      await tx.artifact.updateMany({
        where: { projectId },
        data: { publishedUrl: urlPath, status: 'READY' },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'Another publish is in progress. Try again.' };
    throw error;
  }

  await saveVersionSnapshot(
    projectId,
    plan.newVersion,
    project.artifacts.map((a) => a.slug),
    'PRODUCTION',
  )
    .then(() => enforceDeploymentRetention(projectId, getHostingLimits(tier).deploymentsRetained))
    .catch(() => null);

  revalidatePath('/app/projects');
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);
  revalidatePath(urlPath);
  if (visibility === 'public') captureProjectScreenshots(project.id, project.artifacts);
  void refreshFeatureLedger(projectId, { summarise: false }).catch(() => null);

  await recordUserActivity({
    userId,
    action: 'project.promoted_to_production',
    targetType: 'Project',
    targetId: projectId,
    after: { fromStagingVersion: plan.sourceVersion, newVersion: plan.newVersion, visibility },
  });

  return {
    success: true as const,
    version: plan.newVersion,
    promotedFrom: plan.sourceVersion,
    url: urlPath,
    warnings: gate.warnings.map((w) => w.evidence),
  };
}

/** Rotates the share token (invalidating old links) or opens protection. */
export async function setStagingProtectionAction(projectId: string, mode: 'regenerate' | 'open') {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;

  const staging = await getLiveStagingDeployment(projectId);
  if (!staging) return { error: 'Publish to staging first.' };

  const token = mode === 'open' ? null : generateStagingToken();
  await prisma.deployment.update({ where: { id: staging.id }, data: { accessToken: token } });
  revalidatePath(`/app/projects/${auth.project.workspace.slug}/${auth.project.slug}`);
  return { success: true as const };
}

/** Staging rollback: restores an earlier staging version as the new live staging deployment. */
export async function rollbackStagingAction(projectId: string, deploymentId: string) {
  const auth = await authorize(projectId);
  if ('error' in auth) return auth;
  const { userId, project } = auth;

  const target = await prisma.deployment.findFirst({
    where: { id: deploymentId, projectId, environment: 'STAGING' },
    select: { version: true, status: true },
  });
  if (!target) return { error: 'Staging deployment not found.' };
  if (target.status === 'LIVE') return { error: 'This version is already live on staging.' };
  if (!(await hasVersionSnapshot(projectId, target.version))) {
    return { error: `The files for v${target.version} are no longer stored, so it cannot be restored.` };
  }

  try {
    await restoreVersionSnapshot(projectId, target.version, 'STAGING');
  } catch {
    return { error: 'Rolling back failed while restoring files. Please try again.' };
  }

  const current = await prisma.deployment.findFirst({
    where: { projectId, environment: 'STAGING' },
    orderBy: { version: 'desc' },
    select: { accessToken: true },
  });
  const tier = getAppTier(await getUserBillingFields(userId));
  const out = await activateStagingRow(
    projectId,
    userId,
    project.workspace.slug,
    project.slug,
    project.artifacts.map((a) => a.slug),
    current?.accessToken ?? null,
    tier,
  );
  if ('error' in out) return out;

  await recordUserActivity({
    userId,
    action: 'project.staging_rolled_back',
    targetType: 'Project',
    targetId: projectId,
    after: { fromVersion: target.version, newVersion: out.version },
  });
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);
  return { success: true as const, version: out.version, restoredFrom: target.version };
}

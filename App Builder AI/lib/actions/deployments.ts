"use server";

import { revalidatePath } from "next/cache";

import { recordUserActivity } from "@/lib/activity/record-user-activity";
import { getCachedSession } from "@/lib/auth/cached";
import {
  canPublishVisibility,
  getAppTier,
  publishUpgradeMessage,
} from "@/lib/billing/entitlements";
import { getHostingLimits } from "@/lib/hosting/limits";
import { getAccessibleProject } from "@/lib/projects/access";
import { prisma } from "@/lib/prisma";
import { getUserBillingFields } from "@/lib/queries/billing";
import {
  fromDeploymentVisibility,
  publishedPath,
  type PublishVisibility,
} from "@/lib/publish/visibility";
import {
  enforceDeploymentRetention,
  hasVersionSnapshot,
  restoreVersionSnapshot,
  saveVersionSnapshot,
} from "@/lib/publish/versions";

export type DeploymentHistoryItem = {
  id: string;
  version: number;
  status: string;
  visibility: PublishVisibility;
  isCurrent: boolean;
  createdAt: string;
  canRollback: boolean;
};

export async function getDeploymentHistoryAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: "You must be signed in." };

  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) return { error: "Project not found." };

  const [deployments, user] = await Promise.all([
    prisma.deployment.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
      take: 50,
      select: {
        id: true,
        version: true,
        status: true,
        visibility: true,
        isCurrent: true,
        createdAt: true,
      },
    }),
    getUserBillingFields(userId),
  ]);

  const items: DeploymentHistoryItem[] = await Promise.all(
    deployments.map(async (deployment) => ({
      id: deployment.id,
      version: deployment.version,
      status: deployment.status,
      visibility: fromDeploymentVisibility(deployment.visibility),
      isCurrent: deployment.isCurrent,
      createdAt: deployment.createdAt.toISOString(),
      canRollback:
        !deployment.isCurrent &&
        (await hasVersionSnapshot(projectId, deployment.version)),
    })),
  );

  return {
    deployments: items,
    retained: getHostingLimits(getAppTier(user)).deploymentsRetained,
  };
}

/**
 * Re-publishes a previous version's saved files as a new deployment, so the
 * history stays append-only (rolling back to v2 from v5 creates v6).
 */
export async function rollbackDeploymentAction(
  projectId: string,
  deploymentId: string,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: "You must be signed in." };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    slug: true,
    workspace: { select: { slug: true } },
    artifacts: { select: { slug: true } },
  });
  if (!project) return { error: "Project not found." };

  const target = await prisma.deployment.findFirst({
    where: { id: deploymentId, projectId },
    select: { version: true, visibility: true, isCurrent: true },
  });
  if (!target) return { error: "Deployment not found." };
  if (target.isCurrent) return { error: "This version is already live." };

  const user = await getUserBillingFields(userId);
  const tier = getAppTier(user);
  const visibility = fromDeploymentVisibility(target.visibility);
  if (!canPublishVisibility(tier, visibility)) {
    return { error: publishUpgradeMessage(visibility) };
  }

  if (!(await hasVersionSnapshot(projectId, target.version))) {
    return {
      error: `The files for v${target.version} are no longer stored, so it cannot be restored.`,
    };
  }

  try {
    await restoreVersionSnapshot(projectId, target.version);
  } catch {
    return { error: "Rolling back failed while restoring files. Please try again." };
  }

  const latest = await prisma.deployment.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;
  const urlPath = publishedPath(project.workspace.slug, project.slug);

  await prisma.$transaction(async (tx) => {
    await tx.deployment.updateMany({
      where: { projectId, isCurrent: true },
      data: { isCurrent: false, status: "SUPERSEDED" },
    });
    await tx.deployment.create({
      data: {
        projectId,
        version: nextVersion,
        status: "LIVE",
        visibility: target.visibility,
        domain: urlPath,
        isCurrent: true,
        createdById: userId,
        publishedAt: new Date(),
      },
    });
    await tx.artifact.updateMany({
      where: { projectId },
      data: { publishedUrl: urlPath, status: "READY" },
    });
  });

  await saveVersionSnapshot(
    projectId,
    nextVersion,
    project.artifacts.map((artifact) => artifact.slug),
  )
    .then(() =>
      enforceDeploymentRetention(
        projectId,
        getHostingLimits(tier).deploymentsRetained,
      ),
    )
    .catch(() => null);

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);
  revalidatePath(urlPath);

  await recordUserActivity({
    userId,
    action: "project.rolled_back",
    targetType: "Project",
    targetId: projectId,
    after: { fromVersion: target.version, newVersion: nextVersion },
  });

  return { success: true, version: nextVersion, restoredFrom: target.version };
}

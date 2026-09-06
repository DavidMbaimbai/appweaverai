"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCachedSession } from "@/lib/auth/cached";
import {
  canPublishVisibility,
  FREE_PRIVATE_DEPLOYMENT_LIMIT,
  getAppTier,
  publishUpgradeMessage,
} from "@/lib/billing/entitlements";
import { getAccessibleProject } from "@/lib/projects/access";
import { getUserBillingFields } from "@/lib/queries/billing";
import {
  fromDeploymentVisibility,
  publishedPath,
  toDeploymentVisibility,
  type PublishVisibility,
} from "@/lib/publish/visibility";
import { prisma } from "@/lib/prisma";

const publishSchema = z.object({
  projectId: z.string().min(1),
  visibility: z.enum(["private", "workspace", "public"]),
});

export async function publishProjectAction(
  projectId: string,
  visibility: PublishVisibility,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    return { error: "You must be signed in." };
  }

  const parsed = publishSchema.safeParse({ projectId, visibility });
  if (!parsed.success) {
    return { error: "Invalid publish request." };
  }

  const user = await getUserBillingFields(userId);

  if (!user) {
    return { error: "User not found." };
  }

  const tier = getAppTier(user);

  if (!canPublishVisibility(tier, visibility)) {
    return { error: publishUpgradeMessage(visibility) };
  }

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    slug: true,
    workspace: { select: { slug: true } },
    artifacts: { select: { id: true, slug: true } },
    _count: { select: { files: true } },
  });

  if (!project) {
    return { error: "Project not found." };
  }

  if (project._count.files === 0) {
    return { error: "Build your project before publishing." };
  }

  const artifactPaths = project.artifacts.map(
    (artifact) => `${artifact.slug}/`,
  );
  const artifactFileCount = await prisma.projectFile.count({
    where: {
      projectId,
      OR: artifactPaths.map((prefix) => ({ path: { startsWith: prefix } })),
    },
  });

  if (artifactFileCount === 0) {
    return { error: "Build your project before publishing." };
  }

  if (tier === "free" && visibility === "private") {
    const otherPrivateDeployments = await prisma.deployment.count({
      where: {
        status: "LIVE",
        visibility: "PRIVATE",
        projectId: { not: projectId },
        project: {
          deletedAt: null,
          OR: [{ createdById: userId }, { workspace: { ownerId: userId } }],
        },
      },
    });

    if (otherPrivateDeployments >= FREE_PRIVATE_DEPLOYMENT_LIMIT) {
      return {
        error:
          "Free plan allows one privately published project. Upgrade to Pro to publish more.",
      };
    }
  }

  const latestDeployment = await prisma.deployment.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const nextVersion = (latestDeployment?.version ?? 0) + 1;
  const urlPath = publishedPath(project.workspace.slug, project.slug);
  const deploymentVisibility = toDeploymentVisibility(visibility);

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
        visibility: deploymentVisibility,
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

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);
  revalidatePath(urlPath);

  return {
    success: true,
    url: urlPath,
    visibility: fromDeploymentVisibility(deploymentVisibility),
  };
}

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
import { getHostingLimits } from "@/lib/hosting/limits";
import {
  enforceDeploymentRetention,
  saveVersionSnapshot,
} from "@/lib/publish/versions";
import { recordUserActivity } from "@/lib/activity/record-user-activity";
import { refreshFeatureLedger } from "@/lib/observatory/understand";
import { captureProjectScreenshots } from "@/lib/gallery/capture-screenshot";
import { listProjectFiles, readProjectFile } from "@/lib/project-files";
import { checkHtmlPage, type PreflightIssue } from "@/lib/publish/preflight";
import {
  removePublishedSnapshots,
  snapshotArtifactForPublish,
} from "@/lib/publish/snapshot";

const publishSchema = z.object({
  projectId: z.string().min(1),
  visibility: z.enum(["private", "workspace", "public"]),
});

/** Flow 6, step 26: scans each HTML page for missing content and broken links. */
export async function checkPublishReadinessAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: "You must be signed in." };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    seoTitle: true,
    seoDescription: true,
    artifacts: { select: { slug: true } },
  });
  if (!project) return { error: "Project not found." };

  const issues: PreflightIssue[] = [];
  const seo = { title: project.seoTitle, description: project.seoDescription };

  for (const artifact of project.artifacts) {
    const files = await listProjectFiles(projectId, artifact.slug);
    const prefix = `${artifact.slug}/`;
    const known = new Set(files.map((f) => f.path.slice(prefix.length)));

    for (const relative of known) {
      if (!/\.html?$/i.test(relative)) continue;
      const html = await readProjectFile(projectId, artifact.slug, relative);
      if (html) issues.push(...checkHtmlPage(relative, html, known, seo));
    }
  }

  return { issues: issues.slice(0, 50) };
}

/** Takes a published website offline; the project goes back to Draft. */
export async function unpublishProjectAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: "You must be signed in." };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    slug: true,
    workspace: { select: { slug: true } },
  });
  if (!project) return { error: "Project not found." };

  const urlPath = publishedPath(project.workspace.slug, project.slug);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.deployment.updateMany({
      where: { projectId, isCurrent: true },
      data: { isCurrent: false, status: "SUPERSEDED" },
    });
    await tx.artifact.updateMany({
      where: { projectId },
      data: { publishedUrl: null },
    });
    return updated.count;
  });

  if (result === 0) return { error: "This website is not published." };

  await removePublishedSnapshots(projectId).catch(() => null);

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);
  revalidatePath(urlPath);

  await recordUserActivity({
    userId,
    action: "project.unpublished",
    targetType: "Project",
    targetId: projectId,
    after: { url: urlPath },
  });

  return { success: true };
}

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

  const snapshotResults = await Promise.allSettled(
    project.artifacts.map((artifact) =>
      snapshotArtifactForPublish(projectId, artifact.slug),
    ),
  );
  const snapshotFailed = snapshotResults.some(
    (result) =>
      result.status === "rejected" &&
      (result.reason as NodeJS.ErrnoException)?.code !== "ENOENT",
  );
  if (snapshotFailed) {
    return { error: "Publishing failed while saving your site. Please try again." };
  }

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

  const retention = getHostingLimits(tier).deploymentsRetained;
  await saveVersionSnapshot(
    projectId,
    nextVersion,
    project.artifacts.map((artifact) => artifact.slug),
  )
    .then(() => enforceDeploymentRetention(projectId, retention))
    .catch(() => null);

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);
  revalidatePath(urlPath);

  // Only PUBLIC deployments are visible to anonymous visitors, which is
  // required for the headless capture request below to succeed (private /
  // workspace-only previews require an authenticated session). Fire this
  // off without awaiting so a slow/failed screenshot never delays publish.
  if (visibility === "public") {
    captureProjectScreenshots(project.id, project.artifacts);
  }

  // Rebuild the observatory feature ledger from the newly published files. Best-effort, never blocks publishing.
  void refreshFeatureLedger(projectId, { summarise: false }).catch(() => null);

  await recordUserActivity({
    userId,
    action: "project.published",
    targetType: "Project",
    targetId: projectId,
    after: { url: urlPath, visibility },
  });

  return {
    success: true,
    url: urlPath,
    visibility: fromDeploymentVisibility(deploymentVisibility),
  };
}

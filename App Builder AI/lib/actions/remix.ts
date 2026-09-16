'use server';

import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { redirect } from 'next/navigation';

import { getCachedSession } from '../auth/cached';
import { getDefaultWorkspace } from '../queries/projects';
import { getUserBillingFields } from '../queries/billing';
import {
  getAppTier,
  getProjectLimit,
  projectLimitMessage,
} from '../billing/entitlements';
import { prisma } from '../prisma';
import {
  projectSlugFromPrompt,
  uniqueProjectSlug,
} from '../server/project-slug';
import { PROJECT_WORKSPACE_ROOT } from '../project-files';
import { recordUserActivity } from '../activity/record-user-activity';

/**
 * Creates an independent copy of a publicly-published project for the
 * current user (Lovable-style "Remix"). Only projects with a live PUBLIC
 * deployment can be remixed; secrets, databases, and conversation history
 * are intentionally never copied — only artifacts and file contents.
 */
export async function remixProjectAction(sourceProjectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    redirect(
      `/?auth=login&callbackUrl=${encodeURIComponent('/app/projects')}`,
    );
  }

  const source = await prisma.project.findFirst({
    where: {
      id: sourceProjectId,
      deletedAt: null,
      deployments: {
        some: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
      },
    },
    select: {
      id: true,
      name: true,
      artifacts: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          sortOrder: true,
          codingLanguage: true,
        },
      },
      files: {
        select: { path: true, mimeType: true, sizeBytes: true },
      },
    },
  });

  if (!source) {
    return { error: 'This project is not available to remix.' };
  }

  const workspace = await getDefaultWorkspace(userId);
  if (!workspace) {
    return { error: 'No workspace found. Try signing in again.' };
  }

  const billingUser = await getUserBillingFields(userId);
  const projectLimit = getProjectLimit(getAppTier(billingUser));
  if (projectLimit !== null) {
    const activeProjectCount = await prisma.project.count({
      where: {
        deletedAt: null,
        OR: [
          { createdById: userId },
          { workspace: { ownerId: userId } },
          { members: { some: { userId } } },
        ],
      },
    });

    if (activeProjectCount >= projectLimit) {
      return { error: projectLimitMessage(projectLimit) };
    }
  }

  const name = `${source.name} (Remix)`.slice(0, 80);
  const slug = await uniqueProjectSlug(
    workspace.id,
    projectSlugFromPrompt(source.name),
  );

  const newProject = await prisma.project.create({
    data: {
      name,
      slug,
      description: `Remixed from "${source.name}"`,
      workspaceId: workspace.id,
      createdById: userId,
      members: { create: { userId, role: 'OWNER' } },
      preferences: { create: { userId, lastOpenedAt: new Date() } },
      artifacts: {
        create: source.artifacts.map((artifact) => ({
          name: artifact.name,
          slug: artifact.slug,
          type: artifact.type,
          status: 'DRAFT',
          sortOrder: artifact.sortOrder,
          codingLanguage: artifact.codingLanguage,
        })),
      },
    },
    select: {
      id: true,
      slug: true,
      workspace: { select: { slug: true } },
      artifacts: { select: { id: true, slug: true } },
    },
  });

  const artifactIdBySlug = new Map(
    newProject.artifacts.map((artifact) => [artifact.slug, artifact.id]),
  );

  for (const file of source.files) {
    const separatorIndex = file.path.indexOf('/');
    if (separatorIndex === -1) continue;

    const artifactSlug = file.path.slice(0, separatorIndex);
    const newArtifactId = artifactIdBySlug.get(artifactSlug);
    if (!newArtifactId) continue;

    const sourceAbsolute = path.join(
      PROJECT_WORKSPACE_ROOT,
      source.id,
      file.path,
    );
    const destAbsolute = path.join(
      PROJECT_WORKSPACE_ROOT,
      newProject.id,
      file.path,
    );

    try {
      await mkdir(path.dirname(destAbsolute), { recursive: true });
      await copyFile(sourceAbsolute, destAbsolute);
    } catch {
      continue; // Source file missing on disk; skip best-effort.
    }

    await prisma.projectFile.create({
      data: {
        projectId: newProject.id,
        artifactId: newArtifactId,
        path: file.path,
        storageKey: `workspace/${newProject.id}/${file.path}`,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });
  }

  await recordUserActivity({
    userId,
    action: 'project.remixed',
    targetType: 'Project',
    targetId: newProject.id,
    after: { sourceProjectId: source.id, name },
  });

  redirect(`/app/projects/${newProject.workspace.slug}/${newProject.slug}`);
}

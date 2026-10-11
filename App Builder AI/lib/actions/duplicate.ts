'use server';

import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

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
import { getAccessibleProject } from '../projects/access';
import { recordUserActivity } from '../activity/record-user-activity';

/**
 * Flow 10: creates a separate copy of one of the user's own websites
 * (artifacts, files, brand kit, SEO metadata). Secrets, databases,
 * deployments, domains, form submissions and chat history are not copied.
 */
export async function duplicateProjectAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const source = await getAccessibleProject(projectId, userId, {
    id: true,
    name: true,
    description: true,
    seoTitle: true,
    seoDescription: true,
    seoImageUrl: true,
    faviconUrl: true,
    artifacts: {
      orderBy: { sortOrder: 'asc' },
      select: {
        name: true,
        slug: true,
        type: true,
        sortOrder: true,
        codingLanguage: true,
      },
    },
    files: { select: { path: true, mimeType: true, sizeBytes: true } },
    brandKit: {
      select: {
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
        fontFamily: true,
      },
    },
  });
  if (!source) return { error: 'Project not found.' };

  const workspace = await getDefaultWorkspace(userId);
  if (!workspace) return { error: 'No workspace found. Try signing in again.' };

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

  const name = `${source.name} (Copy)`.slice(0, 80);
  const slug = await uniqueProjectSlug(
    workspace.id,
    projectSlugFromPrompt(name),
  );

  const copy = await prisma.project.create({
    data: {
      name,
      slug,
      description: source.description,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      seoImageUrl: source.seoImageUrl,
      faviconUrl: source.faviconUrl,
      workspaceId: workspace.id,
      createdById: userId,
      members: { create: { userId, role: 'OWNER' } },
      preferences: { create: { userId, lastOpenedAt: new Date() } },
      artifacts: {
        create: source.artifacts.map((artifact) => ({
          name: artifact.name,
          slug: artifact.slug,
          type: artifact.type,
          status: 'DRAFT' as const,
          sortOrder: artifact.sortOrder,
          codingLanguage: artifact.codingLanguage,
        })),
      },
      ...(source.brandKit
        ? { brandKit: { create: { ...source.brandKit } } }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      workspace: { select: { slug: true } },
      artifacts: { select: { id: true, slug: true } },
    },
  });

  const artifactIdBySlug = new Map(copy.artifacts.map((a) => [a.slug, a.id]));

  for (const file of source.files) {
    const artifactSlug = file.path.split('/')[0];
    const artifactId = artifactIdBySlug.get(artifactSlug);
    if (!artifactId || !file.path.includes('/')) continue;

    const destAbsolute = path.join(PROJECT_WORKSPACE_ROOT, copy.id, file.path);
    try {
      await mkdir(path.dirname(destAbsolute), { recursive: true });
      await copyFile(
        path.join(PROJECT_WORKSPACE_ROOT, source.id, file.path),
        destAbsolute,
      );
    } catch {
      continue; // Source file missing on disk.
    }

    await prisma.projectFile.create({
      data: {
        projectId: copy.id,
        artifactId,
        path: file.path,
        storageKey: `workspace/${copy.id}/${file.path}`,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });
  }

  await prisma.artifact.updateMany({
    where: { projectId: copy.id, files: { some: {} } },
    data: { status: 'READY' },
  });

  await recordUserActivity({
    userId,
    action: 'project.duplicated',
    targetType: 'Project',
    targetId: copy.id,
    after: { sourceProjectId: source.id, name },
  });

  revalidatePath('/app/projects');
  redirect(`/app/projects/${copy.workspace.slug}/${copy.slug}`);
}

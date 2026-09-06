'use server';

import { rm } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';

import { getCachedSession } from '@/lib/auth/cached';
import type { ArtifactType } from '@/lib/generated/prisma/client';
import { artifactTypeLabels } from '@/lib/app-types';
import {
  MAX_ARTIFACTS_PER_PROJECT,
  MIN_ARTIFACTS_PER_PROJECT,
} from '@/lib/artifact-types';
import { slugify } from '@/lib/app-utils';
import { artifactWorkspaceDir } from '@/lib/project-files';
import { getAccessibleProject } from '@/lib/projects/access';
import { prisma } from '@/lib/prisma';

const editableProjectSelect = {
  id: true,
  slug: true,
  workspace: { select: { slug: true } },
  _count: { select: { artifacts: true } },
} as const;

async function removeArtifactFromDisk(projectId: string, artifactSlug: string) {
  const dir = artifactWorkspaceDir(projectId, artifactSlug);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

async function uniqueArtifactSlug(projectId: string, base: string) {
  let candidate = slugify(base) || 'artifact';
  let suffix = 2;

  while (
    await prisma.artifact.findFirst({
      where: { projectId, slug: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${slugify(base) || 'artifact'}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export async function createArtifactAction(
  projectId: string,
  type: ArtifactType,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    return { error: 'You must be signed in.' };
  }

  const project = await getAccessibleProject(
    projectId,
    userId,
    editableProjectSelect,
  );

  if (!project) {
    return { error: 'Project not found.' };
  }

  if (project._count.artifacts >= MAX_ARTIFACTS_PER_PROJECT) {
    return {
      error: `Projects can have up to ${MAX_ARTIFACTS_PER_PROJECT} artifacts.`,
    };
  }

  const slug = await uniqueArtifactSlug(
    projectId,
    type.toLowerCase().replace(/_/g, '-'),
  );
  const name = artifactTypeLabels[type];

  const artifact = await prisma.artifact.create({
    data: {
      projectId,
      type,
      name,
      slug,
      sortOrder: project._count.artifacts,
      status: 'DRAFT',
    },
    select: {
      id: true,
      type: true,
      name: true,
      slug: true,
      status: true,
    },
  });

  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);

  return { success: true, artifact };
}

export async function deleteArtifactAction(
  projectId: string,
  artifactId: string,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    return { error: 'You must be signed in.' };
  }

  const project = await getAccessibleProject(
    projectId,
    userId,
    editableProjectSelect,
  );

  if (!project) {
    return { error: 'Project not found.' };
  }

  if (project._count.artifacts <= MIN_ARTIFACTS_PER_PROJECT) {
    return { error: 'Projects must keep at least one artifact.' };
  }

  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!artifact) {
    return { error: 'Artifact not found.' };
  }

  await prisma.projectFile.deleteMany({
    where: {
      projectId,
      path: { startsWith: `${artifact.slug}/` },
    },
  });

  await prisma.artifact.delete({
    where: { id: artifact.id },
  });

  await removeArtifactFromDisk(projectId, artifact.slug);

  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}`);

  return { success: true, artifact };
}

export async function setActiveArtifactPreferenceAction(
  projectId: string,
  artifactId: string,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    return { error: 'You must be signed in.' };
  }

  const project = await getAccessibleProject(
    projectId,
    userId,
    editableProjectSelect,
  );

  if (!project) {
    return { error: 'Project not found.' };
  }

  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, projectId },
    select: { id: true },
  });

  if (!artifact) {
    return { error: 'Artifact not found.' };
  }

  await prisma.userProjectPreference.upsert({
    where: {
      userId_projectId: { userId, projectId },
    },
    create: {
      userId,
      projectId,
      lastActiveArtifactId: artifactId,
    },
    update: {
      lastActiveArtifactId: artifactId,
    },
  });

  return { success: true };
}

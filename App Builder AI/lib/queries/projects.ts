import { cache } from 'react';

import type {
  ArtifactType,
  ArtifactStatus,
  DeploymentVisibility,
} from '@/lib/generated/prisma/client';
import { fromDeploymentVisibility } from '../publish/visibility';
import { projectAccessWhere } from '../projects/access';
import { prisma } from '../prisma';
import {
  AppProject,
  AppProjectDetail,
  AppTrashedProject,
  AppWorkspace,
  ProjectBuildFilter,
  ProjectSort,
} from '../app-types';
import { isPlanModeMessage } from '../agent/prompts';

const LAST_OPENED_STALE_MS = 5 * 60 * 1000;
const MAX_AGENT_MESSAGES = 50;

export async function getDefaultWorkspace(userId: string) {
  return prisma.workspace.findFirst({
    where: {
      ownerId: userId,
      type: 'PERSONAL',
    },
    select: { id: true, name: true, slug: true, type: true },
  });
}

type ListedProject = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  workspaceId: string;
  deletedAt: Date | null;
  artifacts: {
    id: string;
    type: ArtifactType;
    name: string;
    slug: string;
    status: ArtifactStatus;
  }[];
  preferences: {
    isPinned: boolean;
    lastOpenedAt: Date | null;
  }[];
  deployments?: {
    domain: string;
    visibility: string;
    publishedAt: Date | null;
  }[];
  _count: { files: number };
};

type GetProjectsOptions = {
  userId: string;
  workspaceId?: string;
  workspaces?: Pick<AppWorkspace, 'id' | 'name' | 'slug'>[];
  search?: string;
  buildFilter?: ProjectBuildFilter;
  sort?: ProjectSort;
};

function mapListedProject(
  project: ListedProject,
  workspace: { slug: string; name: string } | undefined,
) {
  const preference = project.preferences[0];
  const currentDeployment = project.deployments?.[0];

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    workspaceSlug: workspace?.slug ?? '',
    workspaceName: workspace?.name ?? '',
    isPinned: preference?.isPinned ?? false,
    lastOpenedAt: preference?.lastOpenedAt?.toISOString() ?? null,
    fileCount: project._count.files,
    deployment: currentDeployment
      ? {
          url: currentDeployment.domain,
          visibility: fromDeploymentVisibility(
            currentDeployment.visibility as DeploymentVisibility,
          ),
          publishedAt:
            currentDeployment.publishedAt?.toISOString() ??
            project.updatedAt.toISOString(),
        }
      : null,
    artifacts: project.artifacts,
  };
}

export const getUserWorkspaces = cache(async function getUserWorkspaces(
  userId: string,
): Promise<AppWorkspace[]> {
  const [owned, memberOf] = await Promise.all([
    prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, slug: true, type: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workspaceMember.findMany({
      where: { userId },
      select: {
        workspace: {
          select: { id: true, name: true, slug: true, type: true },
        },
      },
    }),
  ]);

  const map = new Map<string, AppWorkspace>();

  for (const workspace of owned) {
    map.set(workspace.id, workspace);
  }

  for (const entry of memberOf) {
    map.set(entry.workspace.id, entry.workspace);
  }

  return [...map.values()];
});

export async function getProjectsForUser({
  userId,
  workspaceId,
  workspaces: providedWorkspaces,
  search,
  buildFilter = 'all',
  sort = 'last_opened',
}: GetProjectsOptions): Promise<AppProject[]> {
  let workspaces: Pick<AppWorkspace, 'id' | 'name' | 'slug'>[];

  if (workspaceId != null) {
    workspaces = await prisma.workspace.findMany({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true },
    });
  } else if (providedWorkspaces) {
    workspaces = providedWorkspaces;
  } else {
    workspaces = await getUserWorkspaces(userId).then((items) =>
      items.map((item) => ({ id: item.id, name: item.name, slug: item.slug })),
    );
  }

  if (workspaces.length === 0) return [];

  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const workspaceById = new Map(
    workspaces.map((workspace) => [workspace.id, workspace]),
  );

  const projects = await prisma.project.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(buildFilter !== 'all'
        ? {
            artifacts: {
              some: { type: buildFilter as ArtifactType },
            },
          }
        : {}),
    },
    include: {
      artifacts: {
        select: { id: true, type: true, name: true, slug: true, status: true },
        orderBy: { sortOrder: 'asc' },
      },
      preferences: {
        where: { userId },
        select: { isPinned: true, lastOpenedAt: true },
      },
      deployments: {
        where: { isCurrent: true, status: 'LIVE' },
        take: 1,
        select: {
          domain: true,
          visibility: true,
          publishedAt: true,
        },
      },
      _count: {
        select: { files: true },
      },
    },
  });

  const mapped = projects.map(
    (project) =>
      mapListedProject(
        project,
        workspaceById.get(project.workspaceId),
      ) satisfies AppProject,
  );

  mapped.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;

    if (sort === 'name') {
      return a.name.localeCompare(b.name);
    }

    if (sort === 'last_updated') {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }

    const aOpened = a.lastOpenedAt
      ? new Date(a.lastOpenedAt).getTime()
      : new Date(a.updatedAt).getTime();
    const bOpened = b.lastOpenedAt
      ? new Date(b.lastOpenedAt).getTime()
      : new Date(b.updatedAt).getTime();
    return bOpened - aOpened;
  });

  return mapped;
}

export async function getTrashedProjectsForUser(
  userId: string,
): Promise<AppTrashedProject[]> {
  const workspaces = await getUserWorkspaces(userId).then((items) =>
    items.map((item) => ({ id: item.id, name: item.name, slug: item.slug })),
  );

  if (workspaces.length === 0) return [];

  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const workspaceById = new Map(
    workspaces.map((workspace) => [workspace.id, workspace]),
  );

  const projects = await prisma.project.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      deletedAt: { not: null },
    },
    orderBy: { deletedAt: 'desc' },
    include: {
      artifacts: {
        select: { id: true, type: true, name: true, slug: true, status: true },
        orderBy: { sortOrder: 'asc' },
      },
      preferences: {
        where: { userId },
        select: { isPinned: true, lastOpenedAt: true },
      },
      _count: {
        select: { files: true },
      },
    },
  });

  return projects.map((project) => {
    const mapped = mapListedProject(
      project,
      workspaceById.get(project.workspaceId),
    );
    return {
      ...mapped,
      deletedAt: project.deletedAt!.toISOString(),
    } satisfies AppTrashedProject;
  });
}

export async function getProjectBySlugs(
  userId: string,
  workspaceSlug: string,
  projectSlug: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      workspace: { slug: workspaceSlug },
      ...projectAccessWhere(userId),
    },
    include: {
      workspace: { select: { id: true, name: true, slug: true } },
      artifacts: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, type: true, name: true, slug: true, status: true },
      },
      files: {
        orderBy: { path: 'asc' },
        select: { path: true, updatedAt: true, artifactId: true },
      },
      preferences: {
        where: { userId },
        select: {
          isPinned: true,
          lastOpenedAt: true,
          lastActiveArtifactId: true,
        },
      },
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: MAX_AGENT_MESSAGES,
            select: {
              id: true,
              role: true,
              content: true,
              metadata: true,
              createdAt: true,
            },
          },
        },
      },
      deployments: {
        where: { isCurrent: true, status: 'LIVE' },
        take: 1,
        select: {
          domain: true,
          visibility: true,
          publishedAt: true,
        },
      },
    },
  });

  if (!project) return null;

  const preference = project.preferences[0];
  const lastOpenedAt = preference?.lastOpenedAt;
  const shouldRecordOpen =
    !lastOpenedAt || Date.now() - lastOpenedAt.getTime() > LAST_OPENED_STALE_MS;

  if (shouldRecordOpen) {
    await prisma.userProjectPreference.upsert({
      where: {
        userId_projectId: {
          userId,
          projectId: project.id,
        },
      },
      create: {
        userId,
        projectId: project.id,
        lastOpenedAt: new Date(),
      },
      update: {
        lastOpenedAt: new Date(),
      },
    });
  }

  const conversation = project.conversations[0];
  const allMessages = conversation?.messages ?? [];
  const planMode = allMessages.some(
    (message) =>
      message.role === 'SYSTEM' && isPlanModeMessage(message.content),
  );

  const messages = allMessages
    .slice()
    .reverse()
    .filter((message) => message.role !== 'SYSTEM')
    .map((message) => ({
      id: message.id,
      role:
        message.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      metadata:
        message.metadata as AppProjectDetail['messages'][number]['metadata'],
    }));

  const currentDeployment = project.deployments[0];

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    workspaceId: project.workspace.id,
    workspaceSlug: project.workspace.slug,
    workspaceName: project.workspace.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    isPinned: preference?.isPinned ?? false,
    lastOpenedAt: shouldRecordOpen
      ? new Date().toISOString()
      : (lastOpenedAt?.toISOString() ?? null),
    fileCount: project.files.length,
    artifacts: project.artifacts,
    files: project.files.map((file) => ({
      path: file.path,
      updatedAt: file.updatedAt.toISOString(),
      artifactId: file.artifactId,
    })),
    conversationId: conversation?.id ?? null,
    lastActiveArtifactId: preference?.lastActiveArtifactId ?? null,
    messages,
    planMode,
    deployment: currentDeployment
      ? {
          url: currentDeployment.domain,
          visibility: fromDeploymentVisibility(currentDeployment.visibility),
          publishedAt:
            currentDeployment.publishedAt?.toISOString() ??
            project.updatedAt.toISOString(),
        }
      : null,
  };
}

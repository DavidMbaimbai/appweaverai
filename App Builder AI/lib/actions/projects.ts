'use server';

import { rm } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';
import path from 'node:path';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getCachedSession } from '../auth/cached';
import { validatePromptAttachment } from '../prompt-attachments';
import { getDefaultWorkspace } from '../queries/projects';
import { getUserBillingFields } from '../queries/billing';
import {
  getAppTier,
  getProjectLimit,
  projectLimitMessage,
} from '../billing/entitlements';
import { prisma } from '../prisma';
import { dropAllProjectDatabases } from '../databases/provision';
import { deleteProjectSideData } from '../projects/cleanup';
import { getWebsiteType, withWebsiteTypeGuidance } from '../website-types';
import {
  getUserBrandKit,
  hasBrandKitValues,
} from '../brand-kit/project-brand-kit';
import {
  projectSlugFromPrompt,
  uniqueProjectSlug,
} from '../server/project-slug';
import { ArtifactType } from '@/lib/generated/prisma/client';
import { categoryToArtifactType } from '../app-types';
import { PLAN_MODE_SYSTEM_PROMPT } from '../agent/prompts';
import {
  formatAttachmentManifest,
  savePromptAttachmentsToArtifact,
} from '../project-attachments';
import { getAccessibleProject } from '../projects/access';
import { recordUserActivity } from '../activity/record-user-activity';
import { importRepoIntoProject } from '../project-github-import';

const projectIdSchema = z.object({
  projectId: z.string().min(1),
});

const authorizedProjectForActionsSelect = {
  id: true,
  deletedAt: true,
  workspace: { select: { slug: true } },
  slug: true,
} as const;

function revalidateProjectPaths() {
  revalidatePath('/app/projects');
  revalidatePath('/app/trash');
}

async function removeProjectFilesFromDisk(projectId: string) {
  const dirs = [
    path.join(process.cwd(), 'public', 'project-workspace', projectId),
    path.join(process.cwd(), 'public', 'uploads', 'projects', projectId),
  ];

  await Promise.all(
    dirs.map(async (dir) => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }),
  );
}

export async function createProjectAction(formData: FormData) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    redirect('/?auth=login&callbackUrl=/app');
  }

  const prompt = String(formData.get('prompt') ?? '').trim();
  const categoryId = formData.get('categoryId');
  const planMode = formData.get('planMode') === 'true';

  const attachmentFiles: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (
      key.startsWith('attachment-') &&
      value instanceof File &&
      value.size > 0
    ) {
      attachmentFiles.push(value);
    }
  }

  if (!prompt && attachmentFiles.length === 0) {
    return { error: 'Describe what you want to build or attacha file first.' };
  }

  for (const file of attachmentFiles) {
    const validationError = validatePromptAttachment(file);
    if (validationError) {
      return { error: validationError };
    }
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

  const effectivePrompt =
    prompt ||
    `Review the attached file${attachmentFiles.length === 1 ? '' : 's'} and help me plan next steps.`;

  const baseName =
    effectivePrompt.length > 48
      ? `${effectivePrompt.slice(0, 45)}...`
      : effectivePrompt;
  const slug = await uniqueProjectSlug(
    workspace.id,
    projectSlugFromPrompt(effectivePrompt),
  );

  const artifactType: ArtifactType =
    categoryId &&
    typeof categoryId === 'string' &&
    categoryId in categoryToArtifactType
      ? categoryToArtifactType[
          categoryId as keyof typeof categoryToArtifactType
        ]
      : 'WEB_APP';

  const defaultKit = await getUserBrandKit(userId);
  const agentPrompt = withWebsiteTypeGuidance(
    effectivePrompt,
    getWebsiteType(formData.get('websiteType')),
  );

  const project = await prisma.project.create({
    data: {
      name: baseName,
      slug,
      description: effectivePrompt,
      workspaceId: workspace.id,
      createdById: userId,
      ...(hasBrandKitValues(defaultKit)
        ? { brandKit: { create: defaultKit } }
        : {}),
      members: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
      preferences: {
        create: {
          userId,
          lastOpenedAt: new Date(),
        },
      },
      artifacts: {
        create: {
          name: 'Main artifact',
          slug: 'main',
          type: artifactType,
          status: 'DRAFT',
        },
      },
      conversations: {
        create: {
          userId,
          title: planMode ? 'Planning' : 'New conversation',
          messages: {
            create: [
              ...(planMode
                ? [
                    {
                      role: 'SYSTEM' as const,
                      content: PLAN_MODE_SYSTEM_PROMPT,
                    },
                  ]
                : []),
              {
                role: 'USER' as const,
                content: agentPrompt,
              },
            ],
          },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      workspace: { select: { slug: true } },
      artifacts: {
        where: { slug: 'main' },
        select: { id: true, slug: true },
        take: 1,
      },
    },
  });

  const mainArtifact = project.artifacts[0];
  let storedAttachments: Awaited<
    ReturnType<typeof savePromptAttachmentsToArtifact>
  > = [];

  if (attachmentFiles.length > 0 && mainArtifact) {
    storedAttachments = await savePromptAttachmentsToArtifact({
      projectId: project.id,
      artifactId: mainArtifact.id,
      artifactSlug: mainArtifact.slug,
      files: attachmentFiles,
    });

    const userMessageContent =
      agentPrompt + formatAttachmentManifest(storedAttachments);

    const conversation = await prisma.agentConversation.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (conversation) {
      const userMessage = await prisma.agentMessage.findFirst({
        where: { conversationId: conversation.id, role: 'USER' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (userMessage) {
        await prisma.agentMessage.update({
          where: { id: userMessage.id },
          data: {
            content: userMessageContent,
            metadata: { attachments: storedAttachments },
          },
        });
      }
    }
  }

  await recordUserActivity({
    userId,
    action: 'project.created',
    targetType: 'Project',
    targetId: project.id,
    after: { name: baseName, slug: project.slug },
  });

  redirect(`/app/projects/${project.workspace.slug}/${project.slug}`);
}

export async function importGithubRepoAction(formData: FormData) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    redirect('/?auth=login&callbackUrl=/app');
  }

  const owner = String(formData.get('owner') ?? '').trim();
  const repoName = String(formData.get('repo') ?? '').trim();
  const branch = String(formData.get('branch') ?? '').trim() || undefined;

  if (!owner || !repoName) {
    return { error: 'Choose a repository to import.' };
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

  const baseName = `${owner}/${repoName}`;
  const slug = await uniqueProjectSlug(workspace.id, projectSlugFromPrompt(baseName));

  const project = await prisma.project.create({
    data: {
      name: repoName,
      slug,
      description: `Imported from GitHub (${baseName})`,
      workspaceId: workspace.id,
      createdById: userId,
      members: {
        create: { userId, role: 'OWNER' },
      },
      preferences: {
        create: { userId, lastOpenedAt: new Date() },
      },
      artifacts: {
        create: {
          name: 'Main artifact',
          slug: 'main',
          type: 'WEB_APP',
          status: 'DRAFT',
        },
      },
      conversations: {
        create: {
          userId,
          title: 'New conversation',
          messages: {
            create: [
              {
                role: 'USER' as const,
                content: `I imported ${baseName} from GitHub. Please review the code and tell me what this app does.`,
              },
            ],
          },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      workspace: { select: { slug: true } },
      artifacts: {
        where: { slug: 'main' },
        select: { id: true, slug: true },
        take: 1,
      },
    },
  });

  const mainArtifact = project.artifacts[0];
  if (!mainArtifact) {
    return { error: 'Could not initialize the new project.' };
  }

  try {
    await importRepoIntoProject({
      projectId: project.id,
      artifactId: mainArtifact.id,
      artifactSlug: mainArtifact.slug,
      userId,
      owner,
      repo: repoName,
      branch,
    });
  } catch (error) {
    // Clean up the empty project shell so a failed import doesn't leave
    // a dangling, file-less project in the dashboard.
    await prisma.project.delete({ where: { id: project.id } }).catch(() => null);
    const message =
      error instanceof Error ? error.message : 'Could not import repository.';
    return { error: message };
  }

  await recordUserActivity({
    userId,
    action: 'project.github_imported',
    targetType: 'Project',
    targetId: project.id,
    after: { name: repoName, slug: project.slug, repo: baseName },
  });

  redirect(`/app/projects/${project.workspace.slug}/${project.slug}`);
}

export async function moveProjectToTrashAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) return { error: 'Unauthorized' };

  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { error: 'Invalid project.' };

  const project = await getAccessibleProject(
    parsed.data.projectId,
    userId,
    authorizedProjectForActionsSelect,
    { includeTrashed: true },
  );
  if (!project) return { error: 'Project not found.' };

  if (project.deletedAt) {
    return { error: 'Project is already in trash.' };
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id: project.id },
      data: { deletedAt: new Date() },
    }),
    prisma.userProjectPreference.updateMany({
      where: { userId, projectId: project.id },
      data: { isPinned: false },
    }),
  ]);

  revalidateProjectPaths();

  await recordUserActivity({
    userId,
    action: 'project.moved_to_trash',
    targetType: 'Project',
    targetId: project.id,
  });

  return { success: true };
}

/** Flow 10, step 46: lets a duplicated website get its own name. The URL slug is unchanged. */
export async function renameProjectAction(projectId: string, name: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { error: 'Invalid project.' };

  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { error: 'Enter a name for this website.' };

  const project = await getAccessibleProject(
    parsed.data.projectId,
    userId,
    { id: true, name: true },
  );
  if (!project) return { error: 'Project not found.' };

  await prisma.project.update({
    where: { id: project.id },
    data: { name: trimmed },
  });

  revalidateProjectPaths();

  await recordUserActivity({
    userId,
    action: 'project.renamed',
    targetType: 'Project',
    targetId: project.id,
    before: { name: project.name },
    after: { name: trimmed },
  });

  return { success: true, name: trimmed };
}

/** Sets (or clears, with an empty string) where form-submission emails go. */
export async function setNotificationEmailAction(
  projectId: string,
  email: string,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { error: 'Invalid project.' };

  const trimmed = email.trim().toLowerCase();
  if (
    trimmed &&
    (trimmed.length > 254 || !/^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(trimmed))
  ) {
    return { error: 'Enter a valid email address.' };
  }

  const project = await getAccessibleProject(parsed.data.projectId, userId, {
    id: true,
  });
  if (!project) return { error: 'Project not found.' };

  await prisma.project.update({
    where: { id: project.id },
    data: { notificationEmail: trimmed || null },
  });

  return { success: true, email: trimmed };
}

export async function restoreProjectAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) return { error: 'Unauthorized' };

  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { error: 'Invalid project.' };

  const project = await getAccessibleProject(
    parsed.data.projectId,
    userId,
    authorizedProjectForActionsSelect,
    { includeTrashed: true },
  );
  if (!project) return { error: 'Project not found.' };

  if (!project.deletedAt) {
    return { error: 'Project is not in trash.' };
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { deletedAt: null },
  });

  revalidateProjectPaths();

  await recordUserActivity({
    userId,
    action: 'project.restored',
    targetType: 'Project',
    targetId: project.id,
  });

  return { success: true };
}

export async function toggleProjectFavoriteAction(
  projectId: string,
  isPinned: boolean,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) return { error: 'Unauthorized' };

  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { error: 'Invalid project.' };

  const project = await getAccessibleProject(
    parsed.data.projectId,
    userId,
    authorizedProjectForActionsSelect,
  );
  if (!project) return { error: 'Project not found.' };

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
      isPinned,
    },
    update: {
      isPinned,
    },
  });

  revalidateProjectPaths();

  await recordUserActivity({
    userId,
    action: isPinned ? 'project.favorited' : 'project.unfavorited',
    targetType: 'Project',
    targetId: project.id,
  });

  return { success: true, isPinned };
}

export async function permanentlyDeleteProjectAction(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) return { error: 'Unauthorized' };

  const parsed = projectIdSchema.safeParse({ projectId });
  if (!parsed.success) return { error: 'Invalid project.' };

  const project = await getAccessibleProject(
    parsed.data.projectId,
    userId,
    authorizedProjectForActionsSelect,
    { includeTrashed: true },
  );
  if (!project) return { error: 'Project not found.' };

  if (!project.deletedAt) {
    return { error: 'Move the project to trash before deleting permanently.' };
  }

  // Cascade would drop the rows, but the real database/role must be removed too.
  await dropAllProjectDatabases(project.id);
  await deleteProjectSideData(project.id, userId);
  await prisma.project.delete({ where: { id: project.id } });
  await removeProjectFilesFromDisk(project.id);

  revalidateProjectPaths();

  await recordUserActivity({
    userId,
    action: 'project.permanently_deleted',
    targetType: 'Project',
    targetId: project.id,
    before: { slug: project.slug },
  });

  return { success: true };
}

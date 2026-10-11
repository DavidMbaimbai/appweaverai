'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCachedSession } from '../auth/cached';
import { getDefaultWorkspace } from '../queries/projects';
import { getWebsiteTemplateForUse } from '../queries/templates';
import { getUserBillingFields } from '../queries/billing';
import {
  getAppTier,
  getProjectLimit,
  projectLimitMessage,
} from '../billing/entitlements';
import { prisma } from '../prisma';
import {
  getUserBrandKit,
  hasBrandKitValues,
} from '../brand-kit/project-brand-kit';
import {
  projectSlugFromPrompt,
  uniqueProjectSlug,
} from '../server/project-slug';
import { writeProjectFile, readProjectFile } from '../project-files';
import { getAccessibleProject } from '../projects/access';
import { recordUserActivity } from '../activity/record-user-activity';
import { buildTemplatePreviewHtml } from '../template-preview';

/** Returns a self-contained HTML document to preview a template or section. */
export async function getTemplatePreviewAction(templateSlug: string) {
  const session = await getCachedSession();
  if (!session?.user?.id) return { error: 'Unauthorized' };

  const template = await getWebsiteTemplateForUse(templateSlug);
  if (!template) return { error: 'Template not found.' };

  const html = buildTemplatePreviewHtml(template.files, template.kind);
  if (!html) return { error: 'This template has no preview.' };

  return { html };
}

/**
 * Creates a brand-new project whose "main" artifact is pre-populated from a
 * published FULL_TEMPLATE instead of starting from an empty AI conversation
 * (Flow 3 in the product concept: "Choose Templates and Sections"). Because
 * the artifact already has files, the agent panel's auto-run-on-create
 * behavior (see shouldAutoRunInitialReply) is skipped — the user lands
 * straight on their website and customizes it from there.
 */
export async function createProjectFromTemplateAction(templateSlug: string) {
  const template = await getWebsiteTemplateForUse(templateSlug);
  if (!template || template.kind !== 'FULL_TEMPLATE') {
    return { error: 'This template is not available.' };
  }

  return createProjectFromFiles({
    name: template.name,
    description: template.description,
    files: template.files,
    templateLabel: `the "${template.name}" template`,
    activityTemplate: { templateSlug },
  });
}

/** Starts a new website from one of the user's own saved pages (Flow 5 + "Save Full Pages"). */
export async function createProjectFromSavedPageAction(savedPageId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const saved = await prisma.userSavedPage.findFirst({
    where: { id: savedPageId, userId },
    select: { name: true, files: true },
  });
  if (!saved) return { error: 'Saved page not found.' };

  return createProjectFromFiles({
    name: saved.name,
    description: null,
    files: saved.files as { path: string; content: string }[],
    templateLabel: `my saved "${saved.name}" page`,
    activityTemplate: { savedPageId },
  });
}

async function createProjectFromFiles({
  name,
  description,
  files,
  templateLabel,
  activityTemplate,
}: {
  name: string;
  description: string | null;
  files: { path: string; content: string }[];
  templateLabel: string;
  activityTemplate: Record<string, string>;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;

  if (!userId) {
    redirect(
      `/?auth=login&callbackUrl=${encodeURIComponent('/app/templates')}`,
    );
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

  const slug = await uniqueProjectSlug(
    workspace.id,
    projectSlugFromPrompt(name),
  );

  const defaultKit = await getUserBrandKit(userId);

  const project = await prisma.project.create({
    data: {
      name,
      slug,
      description,
      workspaceId: workspace.id,
      createdById: userId,
      ...(hasBrandKitValues(defaultKit)
        ? { brandKit: { create: defaultKit } }
        : {}),
      members: { create: { userId, role: 'OWNER' } },
      preferences: { create: { userId, lastOpenedAt: new Date() } },
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
                content: `I started this website from ${templateLabel}. Help me customize it when I ask.`,
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
    await prisma.project.delete({ where: { id: project.id } }).catch(() => null);
    return { error: 'Could not initialize the new project.' };
  }

  for (const file of files) {
    await writeProjectFile({
      projectId: project.id,
      artifactId: mainArtifact.id,
      artifactSlug: mainArtifact.slug,
      relativePath: file.path,
      content: file.content,
    });
  }

  await prisma.artifact.update({
    where: { id: mainArtifact.id },
    data: { status: 'READY' },
  });

  await recordUserActivity({
    userId,
    action: 'project.created_from_template',
    targetType: 'Project',
    targetId: project.id,
    after: { name, slug: project.slug, ...activityTemplate },
  });

  redirect(`/app/projects/${project.workspace.slug}/${project.slug}`);
}

/** Slugs of the templates/sections the user has starred. */
export async function listTemplateFavoritesAction() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { slugs: [] as string[] };

  const rows = await prisma.userTemplateFavorite.findMany({
    where: { userId },
    select: { template: { select: { slug: true } } },
  });
  return { slugs: rows.map((r) => r.template.slug) };
}

export async function toggleTemplateFavoriteAction(
  templateSlug: string,
  favorite: boolean,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const template = await prisma.websiteTemplate.findUnique({
    where: { slug: templateSlug },
    select: { id: true },
  });
  if (!template) return { error: 'Template not found.' };

  const key = { userId, templateId: template.id };
  if (favorite) {
    await prisma.userTemplateFavorite.upsert({
      where: { userId_templateId: key },
      create: key,
      update: {},
    });
  } else {
    await prisma.userTemplateFavorite.deleteMany({ where: key });
  }
  return { success: true };
}

/**
 * Inserts a reusable SECTION template's markup at the end of <body> in the
 * target artifact's index.html (creating a minimal index.html first if the
 * artifact is empty). Each section ships its own scoped <style>/<script>, so
 * no CSS/JS files need merging for this to render correctly.
 */
export async function insertSectionIntoProjectAction({
  projectId,
  artifactId,
  templateSlug,
}: {
  projectId: string;
  artifactId: string;
  templateSlug: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    artifacts: { where: { id: artifactId }, select: { id: true, slug: true } },
  });
  const artifact = project?.artifacts[0];
  if (!project || !artifact) {
    return { error: 'Project or artifact not found.' };
  }

  const template = await getWebsiteTemplateForUse(templateSlug);
  const section = template?.files.find((file) => file.path === 'section.html');
  if (!template || template.kind !== 'SECTION' || !section) {
    return { error: 'This section is not available.' };
  }

  const existingHtml = await readProjectFile(
    projectId,
    artifact.slug,
    'index.html',
  );

  const baseHtml =
    existingHtml ??
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>My Website</title>\n</head>\n<body>\n</body>\n</html>\n';

  const nextHtml = /<\/body>/i.test(baseHtml)
    ? baseHtml.replace(/<\/body>/i, `${section.content}\n</body>`)
    : `${baseHtml}\n${section.content}`;

  await writeProjectFile({
    projectId,
    artifactId: artifact.id,
    artifactSlug: artifact.slug,
    relativePath: 'index.html',
    content: nextHtml,
  });

  await recordUserActivity({
    userId,
    action: 'project.section_inserted',
    targetType: 'Project',
    targetId: projectId,
    after: { templateSlug },
  });

  revalidatePath(`/app/projects`);

  return { success: true };
}

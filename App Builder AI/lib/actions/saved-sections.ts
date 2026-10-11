'use server';

import { getCachedSession } from '../auth/cached';
import { prisma } from '../prisma';
import { readProjectFile, writeProjectFile } from '../project-files';
import { getAccessibleProject } from '../projects/access';
import { recordUserActivity } from '../activity/record-user-activity';
import { extractPageSections } from '../saved-sections';
import { extractElementHtml } from '../preview/visual-edit';
import { buildTemplatePreviewHtml } from '../template-preview';

/** Flow 5 steps 21-22: save the element clicked in the preview as a template. */
export async function saveElementAsTemplateAction({
  projectId,
  artifactId,
  elementId,
  name,
}: {
  projectId: string;
  artifactId: string;
  elementId: string;
  name: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { error: 'Give the section a name.' };

  const artifact = await getArtifact(projectId, artifactId, userId);
  if (!artifact) return { error: 'Project or artifact not found.' };

  const html = await readProjectFile(projectId, artifact.slug, 'index.html');
  const elementHtml = html ? extractElementHtml(html, elementId) : null;
  if (!elementHtml) return { error: 'That element no longer exists.' };

  const count = await prisma.userSavedSection.count({ where: { userId } });
  if (count >= MAX_SAVED_SECTIONS) {
    return { error: `You can save up to ${MAX_SAVED_SECTIONS} sections.` };
  }

  const saved = await prisma.userSavedSection.create({
    data: { userId, name: trimmed, html: elementHtml },
    select: { id: true, name: true },
  });

  await recordUserActivity({
    userId,
    action: 'section.saved_as_template',
    targetType: 'UserSavedSection',
    targetId: saved.id,
  });

  return { success: true, section: saved };
}

/** Self-contained HTML for previewing one of the user's saved sections. */
export async function getSavedSectionPreviewAction(id: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const saved = await prisma.userSavedSection.findFirst({
    where: { id, userId },
    select: { html: true },
  });
  if (!saved) return { error: 'Saved section not found.' };

  const html = buildTemplatePreviewHtml(
    [{ path: 'section.html', content: saved.html }],
    'SECTION',
  );
  return html ? { html } : { error: 'This section has no preview.' };
}

const MAX_SAVED_SECTIONS = 100;

async function getArtifact(
  projectId: string,
  artifactId: string,
  userId: string,
) {
  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    artifacts: { where: { id: artifactId }, select: { id: true, slug: true } },
  });
  return project?.artifacts[0] ?? null;
}

/** Sections on the artifact's current page that can be saved (Flow 5, step 20). */
export async function listPageSectionsAction(
  projectId: string,
  artifactId: string,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const artifact = await getArtifact(projectId, artifactId, userId);
  if (!artifact) return { error: 'Project or artifact not found.' };

  const html = await readProjectFile(projectId, artifact.slug, 'index.html');
  return { sections: html ? extractPageSections(html) : [] };
}

export async function listSavedSectionsAction() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const sections = await prisma.userSavedSection.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  });
  return { sections };
}

/** Flow 5, steps 21-23: "Save as Template" into the user's personal library. */
export async function saveSectionAsTemplateAction({
  projectId,
  artifactId,
  sectionIndex,
  name,
}: {
  projectId: string;
  artifactId: string;
  sectionIndex: number;
  name: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { error: 'Give the section a name.' };

  const artifact = await getArtifact(projectId, artifactId, userId);
  if (!artifact) return { error: 'Project or artifact not found.' };

  const html = await readProjectFile(projectId, artifact.slug, 'index.html');
  const section = html
    ? extractPageSections(html).find((s) => s.index === sectionIndex)
    : null;
  if (!section) return { error: 'That section no longer exists on the page.' };

  const count = await prisma.userSavedSection.count({ where: { userId } });
  if (count >= MAX_SAVED_SECTIONS) {
    return { error: `You can save up to ${MAX_SAVED_SECTIONS} sections.` };
  }

  const saved = await prisma.userSavedSection.create({
    data: { userId, name: trimmed, html: section.html },
    select: { id: true, name: true },
  });

  await recordUserActivity({
    userId,
    action: 'section.saved_as_template',
    targetType: 'UserSavedSection',
    targetId: saved.id,
  });

  return { success: true, section: saved };
}

export async function deleteSavedSectionAction(id: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  await prisma.userSavedSection.deleteMany({ where: { id, userId } });
  return { success: true };
}

/** Flow 5, step 24: insert a saved section into any of the user's websites. */
export async function insertSavedSectionAction({
  projectId,
  artifactId,
  savedSectionId,
}: {
  projectId: string;
  artifactId: string;
  savedSectionId: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const artifact = await getArtifact(projectId, artifactId, userId);
  if (!artifact) return { error: 'Project or artifact not found.' };

  const saved = await prisma.userSavedSection.findFirst({
    where: { id: savedSectionId, userId },
    select: { html: true },
  });
  if (!saved) return { error: 'Saved section not found.' };

  const existing = await readProjectFile(projectId, artifact.slug, 'index.html');
  const base =
    existing ??
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>My Website</title>\n</head>\n<body>\n</body>\n</html>\n';

  const next = /<\/body>/i.test(base)
    ? base.replace(/<\/body>/i, () => `${saved.html}\n</body>`)
    : `${base}\n${saved.html}`;

  await writeProjectFile({
    projectId,
    artifactId: artifact.id,
    artifactSlug: artifact.slug,
    relativePath: 'index.html',
    content: next,
  });

  return { success: true };
}

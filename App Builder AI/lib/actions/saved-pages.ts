'use server';

import { getCachedSession } from '../auth/cached';
import { prisma } from '../prisma';
import { listProjectFiles, readProjectFile } from '../project-files';
import { getAccessibleProject } from '../projects/access';

const MAX_SAVED_PAGES = 50;
const TEXT_FILE = /\.(html?|css|js|mjs|json|svg|txt)$/i;
const MAX_PAGE_BYTES = 1_000_000;

/** Saves the artifact's whole page (HTML/CSS/JS text files) as a personal template. */
export async function savePageAsTemplateAction({
  projectId,
  artifactId,
  name,
}: {
  projectId: string;
  artifactId: string;
  name: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { error: 'Give the page a name.' };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    artifacts: { where: { id: artifactId }, select: { slug: true } },
  });
  const artifact = project?.artifacts[0];
  if (!artifact) return { error: 'Project or artifact not found.' };

  const prefix = `${artifact.slug}/`;
  const listed = await listProjectFiles(projectId, artifact.slug);
  const files: { path: string; content: string }[] = [];
  let total = 0;

  for (const file of listed) {
    const relative = file.path.slice(prefix.length);
    if (!TEXT_FILE.test(relative)) continue;
    const content = await readProjectFile(projectId, artifact.slug, relative);
    if (content === null) continue;
    total += content.length;
    if (total > MAX_PAGE_BYTES) {
      return { error: 'This page is too large to save as a template.' };
    }
    files.push({ path: relative, content });
  }

  if (!files.some((f) => f.path === 'index.html')) {
    return { error: 'Build a page (index.html) before saving it.' };
  }

  const count = await prisma.userSavedPage.count({ where: { userId } });
  if (count >= MAX_SAVED_PAGES) {
    return { error: `You can save up to ${MAX_SAVED_PAGES} pages.` };
  }

  const saved = await prisma.userSavedPage.create({
    data: { userId, name: trimmed, files },
    select: { id: true, name: true },
  });
  return { success: true, page: saved };
}

export async function listSavedPagesAction() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { pages: [] as { id: string; name: string }[] };

  const pages = await prisma.userSavedPage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  });
  return { pages };
}

export async function deleteSavedPageAction(id: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  await prisma.userSavedPage.deleteMany({ where: { id, userId } });
  return { success: true };
}

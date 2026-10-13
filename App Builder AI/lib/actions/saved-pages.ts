'use server';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getCachedSession } from '../auth/cached';
import { prisma } from '../prisma';
import {
  artifactWorkspaceDir,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
} from '../project-files';
import { getAccessibleProject } from '../projects/access';

const MAX_SAVED_PAGES = 50;
const TEXT_FILE = /\.(html?|css|js|mjs|json|svg|txt)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|ico)$/i;
const MAX_PAGE_BYTES = 4_000_000;

export type SavedPageFile = {
  path: string;
  content: string;
  encoding?: 'base64';
};

/** Saves the artifact's whole page (text files plus images) as a personal template. */
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
  const files: SavedPageFile[] = [];
  let total = 0;

  for (const file of listed) {
    const relative = file.path.slice(prefix.length);
    const isText = TEXT_FILE.test(relative);
    if (!isText && !IMAGE_FILE.test(relative)) continue;

    let entry: SavedPageFile;
    if (isText) {
      const content = await readProjectFile(projectId, artifact.slug, relative);
      if (content === null) continue;
      entry = { path: relative, content };
    } else {
      const buffer = await readFile(
        path.join(artifactWorkspaceDir(projectId, artifact.slug), relative),
      ).catch(() => null);
      if (!buffer) continue;
      entry = {
        path: relative,
        content: buffer.toString('base64'),
        encoding: 'base64',
      };
    }
    total += entry.content.length;
    if (total > MAX_PAGE_BYTES) {
      return { error: 'This page is too large to save as a template.' };
    }
    files.push(entry);
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


/** Adds a saved page to an existing website as a new page under pages/<name>/. */
export async function addSavedPageToProjectAction({
  projectId,
  artifactId,
  savedPageId,
}: {
  projectId: string;
  artifactId: string;
  savedPageId: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    artifacts: { where: { id: artifactId }, select: { id: true, slug: true } },
  });
  const artifact = project?.artifacts[0];
  if (!artifact) return { error: 'Project or artifact not found.' };

  const saved = await prisma.userSavedPage.findFirst({
    where: { id: savedPageId, userId },
    select: { name: true, files: true },
  });
  if (!saved) return { error: 'Saved page not found.' };

  const slug =
    saved.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'page';
  const existing = new Set(
    (await listProjectFiles(projectId, artifact.slug)).map((f) => f.path),
  );
  let folder = slug;
  for (let n = 2; existing.has(`${artifact.slug}/pages/${folder}/index.html`); n++) {
    folder = `${slug}-${n}`;
  }

  for (const file of saved.files as SavedPageFile[]) {
    await writeProjectFile({
      projectId,
      artifactId: artifact.id,
      artifactSlug: artifact.slug,
      relativePath: `pages/${folder}/${file.path}`,
      content:
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : file.content,
    });
  }

  return { success: true, path: `pages/${folder}/index.html` };
}
'use server';

import { applyImageAlts, listPageImages, type PageImage } from '../alt-text';
import { getCachedSession } from '../auth/cached';
import {
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
} from '../project-files';
import { getAccessibleProject } from '../projects/access';

const MAX_PAGES = 30;

export type PageImageGroup = { file: string; images: PageImage[] };

async function resolveArtifact(projectId: string, artifactId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' as const };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    artifacts: { where: { id: artifactId }, select: { id: true, slug: true } },
  });
  const artifact = project?.artifacts[0];
  if (!artifact) return { error: 'Project or artifact not found.' as const };
  return { artifact };
}

/** Lists every image (with its alt text) on each HTML page of the artifact. */
export async function listPageImagesAction(
  projectId: string,
  artifactId: string,
) {
  const resolved = await resolveArtifact(projectId, artifactId);
  if ('error' in resolved) return { error: resolved.error };
  const { artifact } = resolved;

  const prefix = `${artifact.slug}/`;
  const files = (await listProjectFiles(projectId, artifact.slug))
    .map((f) => f.path.slice(prefix.length))
    .filter((p) => /\.html?$/i.test(p))
    .slice(0, MAX_PAGES);

  const groups: PageImageGroup[] = [];
  for (const file of files) {
    const html = await readProjectFile(projectId, artifact.slug, file);
    if (!html) continue;
    const images = listPageImages(html);
    if (images.length > 0) groups.push({ file, images });
  }

  return { groups };
}

/** Saves alt text edits: `edits` maps a page path to { imageIndex: altText }. */
export async function saveImageAltTextAction(
  projectId: string,
  artifactId: string,
  edits: Record<string, Record<number, string>>,
) {
  const resolved = await resolveArtifact(projectId, artifactId);
  if ('error' in resolved) return { error: resolved.error };
  const { artifact } = resolved;

  let saved = 0;
  for (const [file, alts] of Object.entries(edits)) {
    if (!/\.html?$/i.test(file) || Object.keys(alts).length === 0) continue;

    const html = await readProjectFile(projectId, artifact.slug, file);
    if (!html) continue;

    const next = applyImageAlts(html, alts);
    if (next === html) continue;

    await writeProjectFile({
      projectId,
      artifactId: artifact.id,
      artifactSlug: artifact.slug,
      relativePath: file,
      content: next,
    });
    saved += Object.keys(alts).length;
  }

  return { success: true, saved };
}

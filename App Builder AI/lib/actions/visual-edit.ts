'use server';

import { revalidatePath } from 'next/cache';

import { getCachedSession } from '../auth/cached';
import { getAccessibleProject } from '../projects/access';
import { recordUserActivity } from '../activity/record-user-activity';
import { readProjectFile, writeProjectFile } from '../project-files';
import {
  applyVisualEditPatch,
  type VisualEditPatch,
} from '../preview/visual-edit';

/**
 * Persists a single click-to-edit change made in the live preview (Phase B
 * visual editor). The preview iframe never writes files directly — it
 * reports the patch via postMessage, the editor calls this action, and the
 * preview is then reloaded from the updated index.html.
 */
export async function applyVisualEditAction({
  projectId,
  artifactId,
  elementId,
  patch,
}: {
  projectId: string;
  artifactId: string;
  elementId: string;
  patch: VisualEditPatch;
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

  const existingHtml = await readProjectFile(
    projectId,
    artifact.slug,
    'index.html',
  );
  if (existingHtml === null) {
    return { error: 'This artifact has no index.html to edit yet.' };
  }

  let nextHtml: string;
  try {
    nextHtml = applyVisualEditPatch(existingHtml, elementId, patch);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Could not apply that edit.',
    };
  }

  await writeProjectFile({
    projectId,
    artifactId: artifact.id,
    artifactSlug: artifact.slug,
    relativePath: 'index.html',
    content: nextHtml,
  });

  await recordUserActivity({
    userId,
    action: 'project.visual_edit_applied',
    targetType: 'Project',
    targetId: projectId,
    after: { patchKind: patch.kind },
  });

  revalidatePath(`/app/projects`);

  return { success: true };
}

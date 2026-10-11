import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { artifactWorkspaceDir } from '@/lib/project-files';

const PUBLISHED_ROOT = path.join(process.cwd(), '.published');

export function publishedSnapshotDir(projectId: string, artifactSlug: string) {
  return path.join(PUBLISHED_ROOT, projectId, artifactSlug);
}

/**
 * Freezes the artifact's current files as the live version, so later edits
 * stay a draft until the user clicks "Publish updates" (Flow 7).
 */
export async function snapshotArtifactForPublish(
  projectId: string,
  artifactSlug: string,
) {
  const source = artifactWorkspaceDir(projectId, artifactSlug);
  const target = publishedSnapshotDir(projectId, artifactSlug);

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

export async function removePublishedSnapshots(projectId: string) {
  await rm(path.join(PUBLISHED_ROOT, projectId), {
    recursive: true,
    force: true,
  });
}

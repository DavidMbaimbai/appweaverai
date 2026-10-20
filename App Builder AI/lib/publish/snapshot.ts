import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  getProjectBrandKit,
  type BrandKitValues,
} from '@/lib/brand-kit/project-brand-kit';
import { prisma } from '@/lib/prisma';
import type { SeoValues } from '@/lib/preview/seo-shim';
import { artifactWorkspaceDir } from '@/lib/project-files';

export const PUBLISH_META_FILE = '.aw-publish.json';

export type PublishMeta = { brandKit: BrandKitValues; seo: SeoValues };

/** Reads the brand kit and SEO values frozen at publish time, if present. */
export async function readPublishMeta(
  projectId: string,
  artifactSlug: string,
  environment: SnapshotEnvironment = 'PRODUCTION',
): Promise<PublishMeta | null> {
  try {
    const raw = await readFile(
      path.join(
        publishedSnapshotDir(projectId, artifactSlug, environment),
        PUBLISH_META_FILE,
      ),
      'utf8',
    );
    return JSON.parse(raw) as PublishMeta;
  } catch {
    return null;
  }
}

const PUBLISHED_ROOT = path.join(process.cwd(), '.published');

const STAGING_ROOT = path.join(process.cwd(), '.published-staging');

export type SnapshotEnvironment = 'STAGING' | 'PRODUCTION';

export function snapshotRoot(
  projectId: string,
  environment: SnapshotEnvironment = 'PRODUCTION',
) {
  return path.join(
    environment === 'STAGING' ? STAGING_ROOT : PUBLISHED_ROOT,
    projectId,
  );
}

export function publishedSnapshotDir(
  projectId: string,
  artifactSlug: string,
  environment: SnapshotEnvironment = 'PRODUCTION',
) {
  return path.join(snapshotRoot(projectId, environment), artifactSlug);
}

/**
 * Freezes the artifact's current files as the live version, so later edits
 * stay a draft until the user clicks "Publish updates" (Flow 7).
 */
export async function snapshotArtifactForPublish(
  projectId: string,
  artifactSlug: string,
  environment: SnapshotEnvironment = 'PRODUCTION',
) {
  const source = artifactWorkspaceDir(projectId, artifactSlug);
  const target = publishedSnapshotDir(projectId, artifactSlug, environment);

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });

  const [brandKit, project] = await Promise.all([
    getProjectBrandKit(projectId),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { seoTitle: true, seoDescription: true, seoImageUrl: true },
    }),
  ]);
  const meta: PublishMeta = {
    brandKit,
    seo: {
      title: project?.seoTitle,
      description: project?.seoDescription,
      imageUrl: project?.seoImageUrl,
    },
  };
  await writeFile(path.join(target, PUBLISH_META_FILE), JSON.stringify(meta));
}

export async function removePublishedSnapshots(projectId: string) {
  await rm(path.join(PUBLISHED_ROOT, projectId), {
    recursive: true,
    force: true,
  });
}

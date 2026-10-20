import { access } from 'node:fs/promises';
import path from 'node:path';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { prisma } from '@/lib/prisma';
import { createMemory } from '@/lib/project-memory/store';
import { artifactWorkspaceDir, deleteProjectFile, writeProjectFile } from '@/lib/project-files';
import { getAccessibleProject } from '@/lib/projects/access';

import { checksumOf, installFilesOf, validateBundle, type Bundle } from './bundle';
import { planInstall, type InstallConflict, type InstallStrategy } from './install-plan';
import { installGate } from './rules';
import { getViewerState } from './catalog';
import { KNOWN_INTEGRATION_IDS } from './submit';
import type { AssetStatus, AssetType } from './types';

export type InstallRequest = {
  userId: string;
  projectId: string;
  slug: string;
  artifactSlug: string;
  targetDir: string;
  strategy: InstallStrategy;
  /** Plan only: nothing is written and nothing is recorded. */
  dryRun: boolean;
};

export type InstallResult =
  | { status: 'error'; error: string }
  | { status: 'conflicts'; conflicts: InstallConflict[] }
  | { status: 'preview'; writes: string[]; conflicts: InstallConflict[] }
  | { status: 'installed'; filesWritten: string[]; skipped: string[]; version: number };

async function existsOnDisk(absolute: string) {
  try {
    await access(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs the asset's published version into a project the caller can access. Existing files are never overwritten:
 * conflicts are returned first (strategy 'abort') or left untouched (strategy 'skip').
 */
export async function installAsset(request: InstallRequest): Promise<InstallResult> {
  const asset = await prisma.marketplaceAsset.findFirst({
    where: { slug: request.slug, status: 'PUBLISHED', publishedVersion: { not: null } },
    select: { id: true, title: true, type: true, status: true, priceCents: true, license: true, publishedVersion: true },
  });
  if (!asset || asset.publishedVersion === null) return { status: 'error', error: 'This asset is not available for install.' };

  const version = await prisma.marketplaceAssetVersion.findUnique({
    where: { assetId_version: { assetId: asset.id, version: asset.publishedVersion } },
    select: { id: true, version: true, status: true, bundle: true, checksum: true },
  });

  const viewer = await getViewerState(request.userId, asset.id);
  const gate = installGate({
    assetStatus: asset.status as AssetStatus,
    versionStatus: (version?.status as AssetStatus | undefined) ?? null,
    priceCents: asset.priceCents,
    isCreator: viewer.isCreator,
    hasPaidOrder: viewer.hasPaidOrder,
  });
  if (!gate.ok || !version) return { status: 'error', error: gate.ok ? 'This asset is not available for install.' : gate.error };

  // Re-validate stored content at install time and confirm it still matches the checksum recorded at submission.
  const validation = validateBundle(version.bundle, asset.type as AssetType, KNOWN_INTEGRATION_IDS);
  if (!validation.ok || checksumOf(validation.bundle) !== version.checksum) {
    return { status: 'error', error: 'This asset failed an integrity check and cannot be installed.' };
  }
  const bundle: Bundle = validation.bundle;

  const project = await getAccessibleProject(request.projectId, request.userId, {
    id: true,
    artifacts: { select: { id: true, slug: true } },
  });
  if (!project) return { status: 'error', error: 'Project not found.' };
  const artifact = project.artifacts.find((a) => a.slug === request.artifactSlug);
  if (!artifact) return { status: 'error', error: 'Choose one of the project artifacts.' };

  const already = await prisma.marketplaceInstall.findUnique({
    where: { projectId_assetId_versionId: { projectId: project.id, assetId: asset.id, versionId: version.id } },
    select: { id: true },
  });
  if (already) return { status: 'error', error: 'This version is already installed in the project.' };

  const existing = await prisma.projectFile.findMany({
    where: { projectId: project.id, path: { startsWith: `${artifact.slug}/` } },
    select: { path: true },
  });
  const plan = planInstall({
    files: installFilesOf(bundle),
    artifactSlug: artifact.slug,
    targetDir: request.targetDir,
    existingPaths: existing.map((f) => f.path),
    strategy: request.strategy,
  });
  if (!plan.ok) return { status: 'error', error: plan.error };

  // Files that exist on disk without a database row still count as conflicts.
  const artifactDir = artifactWorkspaceDir(project.id, artifact.slug);
  const conflicts = [...plan.conflicts];
  let writes = plan.writes;
  if (writes.length > 0) {
    const onDisk = await Promise.all(writes.map((w) => existsOnDisk(path.join(artifactDir, ...w.relativePath.split('/')))));
    writes.forEach((w, i) => {
      if (onDisk[i]) conflicts.push({ path: w.dbPath, reason: 'exists' });
    });
    writes = writes.filter((_, i) => !onDisk[i]);
  }

  if (conflicts.length > 0 && request.strategy === 'abort') return { status: 'conflicts', conflicts };
  if (request.dryRun) return { status: 'preview', writes: writes.map((w) => w.dbPath), conflicts };
  if (writes.length === 0) return { status: 'error', error: 'Nothing to install: every file already exists.' };

  const written: string[] = [];
  try {
    for (const file of writes) {
      await writeProjectFile({
        projectId: project.id,
        artifactSlug: artifact.slug,
        artifactId: artifact.id,
        relativePath: file.relativePath,
        content: file.content,
      });
      written.push(file.relativePath);
    }
    await prisma.marketplaceInstall.create({
      data: {
        userId: request.userId,
        projectId: project.id,
        assetId: asset.id,
        versionId: version.id,
        version: version.version,
        artifactSlug: artifact.slug,
        targetDir: request.targetDir,
        filesWritten: writes.map((w) => w.dbPath),
      },
    });
  } catch (error) {
    for (const relativePath of written) {
      await deleteProjectFile({ projectId: project.id, artifactSlug: artifact.slug, relativePath }).catch(() => undefined);
    }
    if ((error as { code?: string }).code === 'P2002') return { status: 'error', error: 'This version is already installed in the project.' };
    console.error('Marketplace install failed:', error);
    return { status: 'error', error: 'Install failed and was rolled back.' };
  }

  const filesWritten = writes.map((w) => w.dbPath);
  await createMemory({
    projectId: project.id,
    source: 'SYSTEM',
    createdById: request.userId,
    input: {
      type: 'DECISION',
      title: `Installed marketplace asset: ${asset.title}`.slice(0, 120),
      body: `Installed "${asset.title}" v${version.version} (${asset.type.toLowerCase()}, licence ${asset.license}) into ${artifact.slug}/${request.targetDir || '(root)'}. ${filesWritten.length} file(s) added; no existing file was overwritten.`,
      files: filesWritten.slice(0, 20),
    },
  }).catch(() => undefined);
  await recordUserActivity({
    userId: request.userId,
    action: 'marketplace.installed',
    targetType: 'MarketplaceAsset',
    targetId: asset.id,
    after: { projectId: project.id, version: version.version, files: filesWritten.length, skipped: conflicts.length },
  });

  return { status: 'installed', filesWritten, skipped: conflicts.map((c) => c.path), version: version.version };
}

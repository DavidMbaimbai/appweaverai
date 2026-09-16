import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from './prisma';
import { PROJECT_WORKSPACE_ROOT } from './project-files';

/** Automatic (post agent-turn) checkpoints beyond this count are pruned; named/manual saves are kept forever. */
const MAX_AUTOMATIC_CHECKPOINTS = 20;

function checkpointSnapshotDir(projectId: string, checkpointId: string) {
  return path.join(
    PROJECT_WORKSPACE_ROOT,
    projectId,
    '.checkpoints',
    checkpointId,
  );
}

function liveFileAbsolutePath(projectId: string, filePath: string) {
  return path.join(PROJECT_WORKSPACE_ROOT, projectId, filePath);
}

async function deleteCheckpoint(projectId: string, checkpointId: string) {
  await prisma.projectCheckpoint
    .delete({ where: { id: checkpointId } })
    .catch(() => null);
  await rm(checkpointSnapshotDir(projectId, checkpointId), {
    recursive: true,
    force: true,
  }).catch(() => null);
}

async function pruneAutomaticCheckpoints(projectId: string) {
  const stale = await prisma.projectCheckpoint.findMany({
    where: { projectId, isAutomatic: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
    skip: MAX_AUTOMATIC_CHECKPOINTS,
  });

  for (const checkpoint of stale) {
    await deleteCheckpoint(projectId, checkpoint.id);
  }
}

/**
 * Snapshots every current file of a project into a new checkpoint. Called
 * automatically after each agent turn that wrote files, and manually when a
 * user clicks "Save checkpoint" in the editor's History panel.
 */
export async function createProjectCheckpoint({
  projectId,
  label,
  description,
  createdById,
  isAutomatic = true,
}: {
  projectId: string;
  label: string;
  description?: string | null;
  createdById?: string | null;
  isAutomatic?: boolean;
}) {
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, mimeType: true, sizeBytes: true },
  });

  if (files.length === 0) return null;

  const checkpoint = await prisma.projectCheckpoint.create({
    data: {
      projectId,
      label,
      description: description ?? null,
      createdById: createdById ?? null,
      isAutomatic,
    },
  });

  const snapshotDir = checkpointSnapshotDir(projectId, checkpoint.id);
  const snapshotted: typeof files = [];

  for (const file of files) {
    const source = liveFileAbsolutePath(projectId, file.path);
    const dest = path.join(snapshotDir, file.path);

    try {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(source, dest);
      snapshotted.push(file);
    } catch (error) {
      console.error(
        `[checkpoints] failed to snapshot ${file.path} for checkpoint ${checkpoint.id}:`,
        error,
      );
    }
  }

  if (snapshotted.length > 0) {
    await prisma.projectCheckpointFile.createMany({
      data: snapshotted.map((file) => ({
        checkpointId: checkpoint.id,
        path: file.path,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      })),
    });
  }

  if (isAutomatic) {
    await pruneAutomaticCheckpoints(projectId);
  }

  return checkpoint;
}

export async function listProjectCheckpoints(projectId: string) {
  const checkpoints = await prisma.projectCheckpoint.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      label: true,
      description: true,
      isAutomatic: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
      _count: { select: { files: true } },
    },
  });

  return checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    label: checkpoint.label,
    description: checkpoint.description,
    isAutomatic: checkpoint.isAutomatic,
    createdAt: checkpoint.createdAt.toISOString(),
    fileCount: checkpoint._count.files,
    createdByName:
      checkpoint.createdBy?.name ?? checkpoint.createdBy?.email ?? null,
  }));
}

/**
 * Restores every file to the state recorded in a checkpoint: overwrites
 * existing files, recreates deleted ones, and removes files that were
 * created after the checkpoint. Before doing so, it snapshots the *current*
 * state as its own automatic checkpoint, so a restore is itself always
 * reversible.
 */
export async function restoreProjectCheckpoint({
  projectId,
  checkpointId,
  actorId,
}: {
  projectId: string;
  checkpointId: string;
  actorId?: string | null;
}) {
  const checkpoint = await prisma.projectCheckpoint.findFirst({
    where: { id: checkpointId, projectId },
    include: { files: true },
  });

  if (!checkpoint) {
    return { error: 'Checkpoint not found.' as const };
  }

  if (checkpoint.files.length === 0) {
    return { error: 'This checkpoint has no files to restore.' as const };
  }

  await createProjectCheckpoint({
    projectId,
    label: `Before restoring "${checkpoint.label}"`,
    createdById: actorId,
    isAutomatic: true,
  });

  const snapshotDir = checkpointSnapshotDir(projectId, checkpoint.id);
  const currentFiles = await prisma.projectFile.findMany({
    where: { projectId },
    select: {
      id: true,
      path: true,
      artifactId: true,
      storageKey: true,
    },
  });
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const checkpointPaths = new Set(checkpoint.files.map((file) => file.path));

  let restoredCount = 0;

  for (const file of checkpoint.files) {
    const source = path.join(snapshotDir, file.path);
    const dest = liveFileAbsolutePath(projectId, file.path);

    try {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(source, dest);
    } catch (error) {
      console.error(
        `[checkpoints] failed to restore ${file.path} from checkpoint ${checkpoint.id}:`,
        error,
      );
      continue;
    }

    const existing = currentByPath.get(file.path);
    const storageKey = existing?.storageKey ?? `workspace/${projectId}/${file.path}`;

    await prisma.projectFile.upsert({
      where: { projectId_path: { projectId, path: file.path } },
      create: {
        projectId,
        path: file.path,
        storageKey,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        artifactId: existing?.artifactId ?? null,
      },
      update: {
        storageKey,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });

    restoredCount += 1;
  }

  // Files created after this checkpoint was taken shouldn't survive a
  // restore — remove them so the result exactly matches the checkpoint.
  const filesToRemove = currentFiles.filter(
    (file) => !checkpointPaths.has(file.path),
  );

  for (const file of filesToRemove) {
    await rm(liveFileAbsolutePath(projectId, file.path), {
      force: true,
    }).catch(() => null);
  }

  if (filesToRemove.length > 0) {
    await prisma.projectFile.deleteMany({
      where: { id: { in: filesToRemove.map((file) => file.id) } },
    });
  }

  return {
    success: true as const,
    restoredFiles: restoredCount,
    removedFiles: filesToRemove.length,
  };
}

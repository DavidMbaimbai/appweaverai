import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@/lib/prisma';
import { listProjectFiles, readProjectFile } from '@/lib/project-files';
import { publishedSnapshotDir, PUBLISH_META_FILE, type SnapshotEnvironment } from '@/lib/publish/snapshot';

import { MAX_SCAN_FILE_BYTES, type ScanFile } from './types';

export type ScanSource = 'WORKING' | 'STAGING' | 'PRODUCTION';

const MAX_FILES = 800;
const TEXT_FILE =
  /\.(html?|css|scss|m?[jt]sx?|cjs|vue|svelte|json|md|txt|xml|svg|py|php|rb|ya?ml|toml|sh|ini|conf|env)$|(^|\/)\.env(\.[\w.-]+)?$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|\.next)(\/|$)/;

async function readSnapshot(root: string, dir = root, out: ScanFile[] = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === PUBLISH_META_FILE) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await readSnapshot(root, full, out);
      continue;
    }
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const readable = TEXT_FILE.test(rel) && info.size <= MAX_SCAN_FILE_BYTES;
    out.push({ path: rel, size: info.size, content: readable ? await readFile(full, 'utf8').catch(() => null) : null });
  }
  return out;
}

/** Loads the files a scan should inspect: the frozen snapshot for STAGING/PRODUCTION, otherwise the working files. */
export async function loadScanFiles(
  projectId: string,
  source: ScanSource,
): Promise<{ files: ScanFile[]; source: ScanSource }> {
  const artifacts = await prisma.artifact.findMany({
    where: { projectId },
    orderBy: { sortOrder: 'asc' },
    select: { slug: true },
  });
  if (artifacts.length === 0) return { files: [], source: 'WORKING' };

  const order: ScanSource[] =
    source === 'STAGING' ? ['STAGING', 'WORKING'] : source === 'PRODUCTION' ? ['PRODUCTION', 'WORKING'] : ['WORKING'];

  for (const candidate of order) {
    if (candidate === 'WORKING') break;
    const files = await readSnapshot(publishedSnapshotDir(projectId, artifacts[0].slug, candidate as SnapshotEnvironment));
    if (files.length > 0) return { files, source: candidate };
  }

  const files: ScanFile[] = [];
  const single = artifacts.length === 1;
  for (const artifact of artifacts) {
    const prefix = `${artifact.slug}/`;
    const listed = (await listProjectFiles(projectId, artifact.slug)).filter((f) => !SKIP_DIR.test(f.path));
    for (let i = 0; i < listed.length && files.length < MAX_FILES; i += 25) {
      const chunk = listed.slice(i, i + 25);
      const loaded = await Promise.all(
        chunk.map(async (file) => {
          const relative = file.path.slice(prefix.length);
          const readable = TEXT_FILE.test(relative) && file.sizeBytes <= MAX_SCAN_FILE_BYTES;
          const content = readable ? await readProjectFile(projectId, artifact.slug, relative).catch(() => null) : null;
          return { path: single ? relative : file.path, size: file.sizeBytes, content: typeof content === 'string' ? content : null };
        }),
      );
      files.push(...loaded);
    }
  }
  return { files, source: 'WORKING' };
}

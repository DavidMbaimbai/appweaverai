import { listProjectFiles, readProjectFile } from '@/lib/project-files';
import { prisma } from '@/lib/prisma';

import { diffExports, extractStaticSummary, hashContent, isMappablePath, type ExportDelta } from './extract-static';
import { LIMITS } from './types';

export type ChangedFile = {
  path: string;
  isNew: boolean;
  purpose: string;
  exports: string[];
  routes: string[];
  excerpt: string;
};

export type CodeMapRefresh = {
  changed: ChangedFile[];
  removed: string[];
  unchanged: number;
  exportDeltas: ExportDelta[];
};

export type FileSource = {
  list(): Promise<Array<{ path: string }>>;
  read(relativePath: string): Promise<string | null>;
};

export function projectFileSource(projectId: string, artifactSlug: string): FileSource {
  return {
    list: () => listProjectFiles(projectId, artifactSlug),
    read: (relativePath) => readProjectFile(projectId, artifactSlug, relativePath),
  };
}

/**
 * Incremental refresh: a file is only re-extracted when its content hash differs from the stored one.
 * Paths are stored as `<artifactSlug>/<relative path>`, matching ProjectFile.path.
 */
export async function refreshCodeMap(projectId: string, artifactSlug: string, source?: FileSource): Promise<CodeMapRefresh> {
  const files = source ?? projectFileSource(projectId, artifactSlug);
  const prefix = `${artifactSlug}/`;
  const listed = (await files.list())
    .map((f) => f.path)
    .filter((p) => p.startsWith(prefix) && isMappablePath(p.slice(prefix.length)))
    .slice(0, LIMITS.maxCodeMapFiles);

  const stored = await prisma.projectCodeMapEntry.findMany({
    where: { projectId, path: { startsWith: prefix } },
    select: { path: true, contentHash: true, exports: true },
  });
  const storedByPath = new Map(stored.map((s) => [s.path, s]));

  const changed: ChangedFile[] = [];
  const exportDeltas: ExportDelta[] = [];
  let unchanged = 0;

  for (const dbPath of listed) {
    const relative = dbPath.slice(prefix.length);
    const content = await files.read(relative);
    if (content == null || content.length > LIMITS.maxCodeMapFileBytes) continue;
    const contentHash = hashContent(content);
    const previous = storedByPath.get(dbPath);
    if (previous?.contentHash === contentHash) {
      unchanged += 1;
      continue;
    }
    const summary = extractStaticSummary(relative, content);
    await prisma.projectCodeMapEntry.upsert({
      where: { projectId_path: { projectId, path: dbPath } },
      create: { projectId, path: dbPath, contentHash, ...summary, summarySource: 'STATIC' },
      update: { contentHash, ...summary, summarySource: 'STATIC' },
    });
    const delta = diffExports(relative, previous?.exports, summary.exports);
    if (delta && previous) exportDeltas.push(delta);
    changed.push({
      path: relative,
      isNew: !previous,
      purpose: summary.purpose,
      exports: summary.exports,
      routes: summary.routes,
      excerpt: content.slice(0, 1500),
    });
  }

  const listedSet = new Set(listed);
  const removed = stored.filter((s) => !listedSet.has(s.path)).map((s) => s.path.slice(prefix.length));
  if (removed.length > 0) {
    await prisma.projectCodeMapEntry.deleteMany({ where: { projectId, path: { in: removed.map((r) => `${prefix}${r}`) } } });
  }
  return { changed, removed, unchanged, exportDeltas };
}

/** Stores model-written purposes, only for the capped number of files and only where the file is still unchanged. */
export async function applyLlmPurposes(projectId: string, artifactSlug: string, purposes: Array<{ path: string; purpose: string }>) {
  let applied = 0;
  for (const item of purposes.slice(0, LIMITS.maxLlmFilesPerRun)) {
    const purpose = item.purpose.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (purpose.length < 5) continue;
    const result = await prisma.projectCodeMapEntry.updateMany({
      where: { projectId, path: `${artifactSlug}/${item.path}` },
      data: { purpose, summarySource: 'LLM' },
    });
    applied += result.count;
  }
  return applied;
}

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { artifactWorkspaceDir } from '@/lib/project-files';

export { artifactWorkspaceDir } from '@/lib/project-files';

export async function listWorkspaceRelativePaths(
  projectId: string,
  artifactSlug: string,
) {
  const root = artifactWorkspaceDir(projectId, artifactSlug);

  async function walk(currentDir: string, prefix = ''): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(absolute, relative)));
      } else {
        files.push(relative);
      }
    }
    return files;
  }

  return walk(root);
}

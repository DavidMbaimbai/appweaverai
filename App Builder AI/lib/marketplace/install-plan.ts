import { validateRelativePath, type BundleFile } from './bundle';

export type InstallStrategy = 'abort' | 'skip';

export type InstallConflict = { path: string; reason: 'exists' | 'file_folder_clash' };

export type InstallPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Project-relative paths ("<artifact>/<folder>/<file>") that will be created. */
      writes: Array<{ relativePath: string; dbPath: string; content: string }>;
      conflicts: InstallConflict[];
      skipped: string[];
    };

/**
 * Pure planning step: decides which bundle files can be written without touching anything that already exists.
 * Existing files are NEVER overwritten: with 'abort' any conflict stops the install (the caller shows the list),
 * with 'skip' only conflicting files are left out.
 */
export function planInstall(args: {
  files: BundleFile[];
  artifactSlug: string;
  targetDir: string;
  existingPaths: Iterable<string>;
  strategy: InstallStrategy;
}): InstallPlan {
  const dirError = validateRelativePath(args.targetDir, { allowEmpty: true });
  if (dirError) return { ok: false, error: `Install folder: ${dirError}` };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(args.artifactSlug)) return { ok: false, error: 'Invalid artifact.' };

  const existing = Array.from(args.existingPaths, (p) => p.toLowerCase());
  const existingSet = new Set(existing);
  const writes: Array<{ relativePath: string; dbPath: string; content: string }> = [];
  const conflicts: InstallConflict[] = [];

  for (const file of args.files) {
    const pathError = validateRelativePath(file.path, { requireExtension: true });
    if (pathError) return { ok: false, error: `${file.path.slice(0, 60)}: ${pathError}` };
    const relativePath = args.targetDir ? `${args.targetDir}/${file.path}` : file.path;
    if (validateRelativePath(relativePath)) return { ok: false, error: 'Install folder plus file path is too deep or too long.' };
    const dbPath = `${args.artifactSlug}/${relativePath}`;
    const lower = dbPath.toLowerCase();

    if (existingSet.has(lower)) {
      conflicts.push({ path: dbPath, reason: 'exists' });
    } else if (existing.some((p) => p.startsWith(`${lower}/`) || lower.startsWith(`${p}/`))) {
      conflicts.push({ path: dbPath, reason: 'file_folder_clash' });
    } else {
      writes.push({ relativePath, dbPath, content: file.content });
    }
  }

  if (conflicts.length > 0 && args.strategy === 'abort') return { ok: true, writes: [], conflicts, skipped: [] };
  return { ok: true, writes, conflicts, skipped: conflicts.map((c) => c.path) };
}

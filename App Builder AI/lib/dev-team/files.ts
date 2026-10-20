import { authoriseProposal, normaliseProposalPath } from './permissions';
import type { DevTeamRoleName } from './types';

export type ProjectFileInfo = { path: string; size: number };

const TEXT_FILE = /\.(html?|css|scss|sass|less|m?[jt]sx?|cjs|vue|svelte|json|md|txt|xml|svg|py|php|rb|go|ya?ml|toml|sh|sql|prisma|ini|conf)$|(^|\/)(Dockerfile[\w.-]*|Makefile|\.env\.example|\.gitignore|\.dockerignore)$/i;

export const MAX_PROMPT_FILES = 25;

export function isTextPath(path: string) {
  return TEXT_FILE.test(path);
}

/**
 * Which files a task is shown, in priority order: the planner's hints, then files inside the role's own scope,
 * then (read-only reviewers only) everything else small enough. Secrets, lockfiles and binaries never qualify.
 */
export function selectFilesForTask(args: {
  role: DevTeamRoleName;
  hints: string[];
  files: ProjectFileInfo[];
  maxFileBytes: number;
  maxFiles?: number;
}): Array<{ path: string; editable: boolean }> {
  const max = args.maxFiles ?? MAX_PROMPT_FILES;
  const usable = new Map<string, ProjectFileInfo>();
  for (const file of args.files) {
    const check = normaliseProposalPath(file.path);
    if (check.ok && isTextPath(check.path) && file.size <= args.maxFileBytes) usable.set(check.path, file);
  }

  const ordered: string[] = [];
  const add = (path: string) => {
    if (usable.has(path) && !ordered.includes(path)) ordered.push(path);
  };
  for (const hint of args.hints) {
    const check = normaliseProposalPath(hint);
    if (check.ok) add(check.path);
  }
  const inScope = [...usable.values()].filter((f) => authoriseProposal(args.role, f.path).allowed).sort((a, b) => a.size - b.size);
  for (const file of inScope) add(file.path);
  if (inScope.length === 0) {
    for (const file of [...usable.values()].sort((a, b) => a.size - b.size)) add(file.path);
  }

  return ordered.slice(0, max).map((path) => ({ path, editable: authoriseProposal(args.role, path).allowed }));
}

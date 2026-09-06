import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  artifactWorkspaceDir,
  listWorkspaceRelativePaths,
} from '@/lib/preview/list-workspace-paths';

const JSX_EXTENSIONS = new Set(['.jsx', '.tsx']);

const REACT_ENTRY_CANDIDATES = [
  'main.jsx',
  'main.tsx',
  'src/main.jsx',
  'src/main.tsx',
  'index.jsx',
  'index.tsx',
  'App.jsx',
  'src/App.jsx',
];

/** ESM bundle entries — excludes classic `script.js` (served statically). */
const ESM_ENTRY_CANDIDATES = [
  'main.js',
  'main.mjs',
  'src/main.js',
  'src/main.mjs',
  'index.js',
  'index.mjs',
];

export type ProjectStack = 'static' | 'esbuild-react' | 'esbuild-esm';

function normalizePath(filePath: string) {
  return filePath.toLowerCase();
}

function scriptTags(html: string) {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].map(
    (match) => match[1] ?? '',
  );
}

export function hasModuleScript(html: string) {
  return scriptTags(html).some((attrs) =>
    /type\s*=\s*["']module["']/i.test(attrs),
  );
}

export function hasClassicExternalScript(html: string) {
  return scriptTags(html).some((attrs) => {
    if (/type\s*=\s*["']module["']/i.test(attrs)) return false;
    return /src\s*=\s*["'][^"']+["']/i.test(attrs);
  });
}

export function getModuleScriptSrc(html: string) {
  for (const attrs of scriptTags(html)) {
    if (!/type\s*=\s*["']module["']/i.test(attrs)) continue;
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch?.[1]) {
      return srcMatch[1].replace(/^\.\//, '');
    }
  }
  return null;
}

export function detectProjectStack(
  relativePaths: string[],
  indexHtml?: string | null,
): ProjectStack {
  const normalized = relativePaths.map(normalizePath);

  const hasJsx = normalized.some((filePath) =>
    ['.jsx', '.tsx'].some((ext) => filePath.endsWith(ext)),
  );
  const hasReactEntry = normalized.some((filePath) =>
    REACT_ENTRY_CANDIDATES.map((candidate) => candidate.toLowerCase()).includes(
      filePath,
    ),
  );

  if (hasJsx || hasReactEntry) {
    return 'esbuild-react';
  }

  if (indexHtml) {
    if (hasClassicExternalScript(indexHtml) && !hasModuleScript(indexHtml)) {
      return 'static';
    }

    if (hasModuleScript(indexHtml)) {
      return 'esbuild-esm';
    }

    if (normalized.includes('index.html')) {
      return 'static';
    }
  }

  const hasEsmEntry = normalized.some((filePath) =>
    ESM_ENTRY_CANDIDATES.map((candidate) => candidate.toLowerCase()).includes(
      filePath,
    ),
  );
  if (hasEsmEntry) {
    return 'esbuild-esm';
  }

  if (normalized.includes('index.html') && normalized.includes('script.js')) {
    return 'static';
  }

  return 'static';
}

export async function resolveProjectStack(
  projectId: string,
  artifactSlug: string,
) {
  const relativePaths = await listWorkspaceRelativePaths(
    projectId,
    artifactSlug,
  );
  const indexHtml = await readArtifactIndexHtml(projectId, artifactSlug);
  return {
    stack: detectProjectStack(relativePaths, indexHtml),
    relativePaths,
    indexHtml,
  };
}

export function findReactBundleEntry(relativePaths: string[]) {
  for (const candidate of REACT_ENTRY_CANDIDATES) {
    if (relativePaths.includes(candidate)) {
      return candidate;
    }
  }

  const jsxFile = relativePaths.find((filePath) =>
    JSX_EXTENSIONS.has(`.${filePath.split('.').pop() ?? ''}`),
  );
  return jsxFile ?? null;
}

export function findEsmBundleEntry(
  relativePaths: string[],
  indexHtml?: string | null,
) {
  const moduleSrc = indexHtml ? getModuleScriptSrc(indexHtml) : null;
  if (moduleSrc && relativePaths.includes(moduleSrc)) {
    return moduleSrc;
  }

  for (const candidate of ESM_ENTRY_CANDIDATES) {
    if (relativePaths.includes(candidate)) {
      return candidate;
    }
  }

  return (
    relativePaths.find(
      (filePath) =>
        (filePath.endsWith('.js') || filePath.endsWith('.mjs')) &&
        filePath !== 'script.js',
    ) ?? null
  );
}

export function findBundleEntry(
  relativePaths: string[],
  stack?: ProjectStack,
  indexHtml?: string | null,
) {
  const resolvedStack = stack ?? detectProjectStack(relativePaths, indexHtml);
  if (resolvedStack === 'esbuild-react') {
    return findReactBundleEntry(relativePaths);
  }
  if (resolvedStack === 'esbuild-esm') {
    return findEsmBundleEntry(relativePaths, indexHtml);
  }
  return null;
}

export async function readArtifactIndexHtml(
  projectId: string,
  artifactSlug: string,
) {
  const absolute = path.join(
    artifactWorkspaceDir(projectId, artifactSlug),
    'index.html',
  );
  try {
    return await readFile(absolute, 'utf8');
  } catch {
    return null;
  }
}

export function extractIndexHeadContent(html: string) {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!match) return '';

  return match[1]
    .replace(/<base\s[^>]*\/?>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();
}

export function extractIndexBodyContent(html: string) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) return null;

  const inner = match[1].replace(/<script[\s\S]*?<\/script>/gi, '').trim();
  return inner || null;
}

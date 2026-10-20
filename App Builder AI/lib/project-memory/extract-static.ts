import { createHash } from 'node:crypto';

export type StaticSummary = {
  purpose: string;
  exports: string[];
  routes: string[];
  dependencies: string[];
};

export const CODE_EXTENSIONS = /\.(tsx?|jsx?|mjs|cjs|html?|css|json|md|sql|prisma)$/i;
const SKIP_PATHS = /(^|\/)(node_modules|\.next|dist|build|\.checkpoints|__prompt_attachments__)(\/|$)|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(js|css)$/i;

export function isMappablePath(relativePath: string) {
  return CODE_EXTENSIONS.test(relativePath) && !SKIP_PATHS.test(relativePath);
}

export function hashContent(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

const MAX_ITEMS = 12;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, MAX_ITEMS);
}

function matchAll(content: string, pattern: RegExp, group = 1) {
  const out: string[] = [];
  for (const match of content.matchAll(pattern)) {
    if (match[group]) out.push(match[group]);
    if (out.length > 60) break;
  }
  return out;
}

/** Route inferred from a Next.js/Express-style path, e.g. app/api/x/route.ts -> /api/x. */
export function routeFromPath(relativePath: string): string | null {
  const normalised = relativePath.replace(/\\/g, '/');
  const app = normalised.match(/(?:^|\/)app\/(?:(.*)\/)?(page|route)\.[jt]sx?$/);
  if (app) return `/${(app[1] ?? '').replace(/\([^)]*\)\/?/g, '').replace(/\/$/, '')}`;
  const pages = normalised.match(/(?:^|\/)pages\/(.*)\.[jt]sx?$/);
  if (pages) return `/${pages[1].replace(/\/index$/, '').replace(/^index$/, '')}`;
  return null;
}

function describeByPath(relativePath: string, exportsList: string[]) {
  const name = relativePath.split('/').pop() ?? relativePath;
  const route = routeFromPath(relativePath);
  if (route !== null && /route\.[jt]s$/.test(name)) return `API route handler for ${route || '/'}`;
  if (route !== null) return `Page for ${route || '/'}`;
  if (/\.test\.|\.spec\./.test(name)) return 'Tests';
  if (/\.css$/i.test(name)) return 'Stylesheet';
  if (/\.html?$/i.test(name)) return 'HTML document';
  if (/\.prisma$|\.sql$/i.test(name)) return 'Database schema or migration';
  if (/\.json$/i.test(name)) return 'JSON configuration or data';
  if (/\.md$/i.test(name)) return 'Documentation';
  if (exportsList.length > 0) return `Module exporting ${exportsList.slice(0, 4).join(', ')}`;
  return 'Source file';
}

/** Cheap deterministic extraction of imports, exports and routes; no model involved. */
export function extractStaticSummary(relativePath: string, content: string): StaticSummary {
  const isJs = /\.(tsx?|jsx?|mjs|cjs)$/i.test(relativePath);
  const exportsList: string[] = [];
  const routes: string[] = [];
  const dependencies: string[] = [];

  if (isJs) {
    exportsList.push(
      ...matchAll(content, /export\s+(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g),
      ...matchAll(content, /export\s*\{([^}]+)\}/g).flatMap((group) =>
        group.split(',').map((part) => part.trim().split(/\s+as\s+/).pop()?.trim() ?? ''),
      ),
    );
    if (/export\s+default\b/.test(content)) exportsList.push('default');

    dependencies.push(
      ...matchAll(content, /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
      ...matchAll(content, /import\s*['"]([^'"]+)['"]/g),
      ...matchAll(content, /require\(\s*['"]([^'"]+)['"]\s*\)/g),
    );

    const fileRoute = routeFromPath(relativePath);
    if (fileRoute !== null) {
      const methods = matchAll(content, /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g);
      routes.push(...(methods.length > 0 ? methods.map((m) => `${m} ${fileRoute || '/'}`) : [fileRoute || '/']));
    }
    for (const match of content.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
      routes.push(`${match[1].toUpperCase()} ${match[2]}`);
    }
  } else if (/\.html?$/i.test(relativePath)) {
    dependencies.push(...matchAll(content, /<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi));
  } else if (/\.css$/i.test(relativePath)) {
    dependencies.push(...matchAll(content, /@import\s+(?:url\()?['"]([^'"]+)['"]/g));
  }

  const cleanExports = unique(exportsList.filter((e) => /^[A-Za-z_$][\w$]*$/.test(e)));
  return {
    purpose: describeByPath(relativePath, cleanExports),
    exports: cleanExports,
    routes: unique(routes),
    dependencies: unique(dependencies),
  };
}

export type ExportDelta = { path: string; added: string[]; removed: string[] };

export function diffExports(path: string, before: string[] | undefined, after: string[]): ExportDelta | null {
  const prev = new Set(before ?? []);
  const next = new Set(after);
  const added = after.filter((e) => !prev.has(e));
  const removed = (before ?? []).filter((e) => !next.has(e));
  return added.length || removed.length ? { path, added, removed } : null;
}

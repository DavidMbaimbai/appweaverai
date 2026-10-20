export type SourceFile = { path: string; content?: string | null };

export type EvidenceItem = {
  type: 'file' | 'route' | 'deployment' | 'health' | 'smoke' | 'knowledge' | 'scan_absent' | 'issue';
  ref: string;
  detail: string;
};

export type FileInventory = {
  framework: string;
  totalFiles: number;
  scannedFiles: number;
  pages: string[];
  apiEndpoints: string[];
  modules: Array<{ name: string; files: number }>;
};

const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|html?|vue|svelte|json|css|md)$/i;

export function isScannableText(path: string) {
  return TEXT_EXT.test(path);
}

/** Drops the leading artifact slug segment that ProjectFile paths carry. */
export function stripArtifactSlug(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const index = normalized.indexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function routeFromAppPath(relative: string, marker: 'page' | 'route'): string | null {
  const match = relative.match(
    new RegExp(`(?:^|/)(?:src/)?app/(.*?)/?${marker}\\.(?:tsx?|jsx?)$`),
  );
  if (!match) return null;
  const segments = match[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segments.join('/')}`;
}

function routeFromPagesPath(relative: string): { route: string; api: boolean } | null {
  const match = relative.match(/(?:^|\/)(?:src\/)?pages\/(.+?)\.(?:tsx?|jsx?|vue|svelte)$/);
  if (!match) return null;
  const parts = match[1].split('/');
  if (parts[parts.length - 1] === 'index') parts.pop();
  if (parts[0] === '_app' || parts[0] === '_document') return null;
  const api = parts[0] === 'api';
  return { route: `/${parts.join('/')}`, api };
}

export function detectFramework(files: SourceFile[]): string {
  const pkg = files.find((f) => stripArtifactSlug(f.path) === 'package.json' && f.content);
  if (pkg?.content) {
    try {
      const json = JSON.parse(pkg.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...json.devDependencies, ...json.dependencies };
      if (deps.next) return 'Next.js';
      if (deps.nuxt) return 'Nuxt';
      if (deps['@sveltejs/kit']) return 'SvelteKit';
      if (deps.astro) return 'Astro';
      if (deps.vue) return deps.vite ? 'Vue (Vite)' : 'Vue';
      if (deps.react) return deps.vite ? 'React (Vite)' : 'React';
      if (deps.express || deps.fastify || deps.hono) return 'Node server';
    } catch {
      // Unparseable package.json: fall through to path heuristics.
    }
  }
  const paths = files.map((f) => stripArtifactSlug(f.path));
  if (paths.some((p) => /(^|\/)app\/.*page\.tsx?$/.test(p))) return 'Next.js';
  if (paths.some((p) => /\.(tsx|jsx)$/.test(p))) return 'React';
  if (paths.some((p) => /\.html?$/.test(p))) return 'Static HTML';
  return 'Unknown';
}

export function buildInventory(files: SourceFile[]): FileInventory {
  const pages = new Set<string>();
  const api = new Set<string>();
  const moduleCounts = new Map<string, number>();

  for (const file of files) {
    const relative = stripArtifactSlug(file.path);

    const pageRoute = routeFromAppPath(relative, 'page');
    if (pageRoute) pages.add(pageRoute);
    const apiRoute = routeFromAppPath(relative, 'route');
    if (apiRoute) api.add(apiRoute);

    const pagesRoute = routeFromPagesPath(relative);
    if (pagesRoute) (pagesRoute.api ? api : pages).add(pagesRoute.route);

    const html = relative.match(/^(?:public\/)?(.+)\.html?$/i);
    if (html && !/node_modules/.test(relative)) {
      pages.add(html[1] === 'index' ? '/' : `/${html[1].replace(/\/index$/, '')}`);
    }
    if (/^(?:src\/)?(?:api|server|functions)\/.+\.(?:tsx?|jsx?|mjs)$/.test(relative) && !pagesRoute) {
      api.add(`/${relative.replace(/^src\//, '').replace(/\.(?:tsx?|jsx?|mjs)$/, '')}`);
    }

    if (file.content && /\.(tsx?|jsx?)$/.test(relative)) {
      for (const m of file.content.matchAll(/<Route\b[^>]*\bpath=["']([^"']+)["']/g)) {
        pages.add(m[1].startsWith('/') ? m[1] : `/${m[1]}`);
      }
    }

    const segments = relative.split('/');
    const top = segments[0] === 'src' ? segments[1] : segments[0];
    if (segments.length > 1 && top && !top.includes('.')) {
      moduleCounts.set(top, (moduleCounts.get(top) ?? 0) + 1);
    }
  }

  return {
    framework: detectFramework(files),
    totalFiles: files.length,
    scannedFiles: files.filter((f) => typeof f.content === 'string').length,
    pages: [...pages].sort(),
    apiEndpoints: [...api].sort(),
    modules: [...moduleCounts.entries()]
      .map(([name, count]) => ({ name, files: count }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 20),
  };
}

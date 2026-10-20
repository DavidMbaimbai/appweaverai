import { MANIFEST_PATH, SERVICE_WORKER_PATH, toText, type OutputFiles } from './pwa';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type ReadinessCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  weight: number;
  detail: string;
};

export type PwaReadiness = {
  score: number;
  checks: ReadinessCheck[];
  /** True when every blocking check passes, i.e. browsers should offer installation. */
  installable: boolean;
};

const BLOCKING = new Set(['https', 'index', 'manifest-link', 'manifest-fields', 'manifest-icons', 'icon-files', 'service-worker']);

type Manifest = {
  name?: unknown;
  short_name?: unknown;
  start_url?: unknown;
  display?: unknown;
  theme_color?: unknown;
  background_color?: unknown;
  icons?: unknown;
};

function parseManifest(files: OutputFiles, htmlManifestHref: string | null): { path: string; manifest: Manifest | null } {
  const candidates = [htmlManifestHref, MANIFEST_PATH, 'manifest.json'].filter((p): p is string => Boolean(p));
  for (const raw of candidates) {
    const path = raw.replace(/^\.?\//, '').replace(/^\/+/, '');
    const file = files[path];
    if (!file) continue;
    try {
      return { path, manifest: JSON.parse(toText(file)) as Manifest };
    } catch {
      return { path, manifest: null };
    }
  }
  return { path: MANIFEST_PATH, manifest: null };
}

function iconList(manifest: Manifest | null) {
  if (!manifest || !Array.isArray(manifest.icons)) return [];
  return manifest.icons.filter(
    (icon): icon is { src: string; sizes?: string; type?: string; purpose?: string } =>
      Boolean(icon) && typeof (icon as { src?: unknown }).src === 'string',
  );
}

function hasSize(icon: { sizes?: string; type?: string; src: string }, size: number) {
  const sizes = (icon.sizes ?? '').toLowerCase().split(/\s+/);
  if (sizes.includes(`${size}x${size}`)) return true;
  // A scalable SVG declared as "any" satisfies every size.
  return sizes.includes('any') && (icon.type === 'image/svg+xml' || icon.src.toLowerCase().endsWith('.svg'));
}

function isHttps(url: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function evaluatePwaReadiness(input: { files: OutputFiles; publicUrl?: string | null }): PwaReadiness {
  const { files } = input;
  const checks: ReadinessCheck[] = [];
  const add = (id: string, label: string, weight: number, status: CheckStatus, detail: string) =>
    checks.push({ id, label, weight, status, detail });

  const publicUrl = input.publicUrl ?? null;
  if (!publicUrl) {
    add('https', 'Served over HTTPS', 15, 'fail', 'Publish the project first: installability needs a public HTTPS URL.');
  } else if (isHttps(publicUrl)) {
    add('https', 'Served over HTTPS', 15, 'pass', publicUrl);
  } else {
    add('https', 'Served over HTTPS', 15, 'fail', `${publicUrl} is not HTTPS. Browsers will not offer installation.`);
  }

  const indexFile = files['index.html'];
  const html = indexFile ? toText(indexFile) : '';
  add(
    'index',
    'Entry page present',
    5,
    indexFile ? 'pass' : 'fail',
    indexFile ? 'index.html found.' : 'No index.html in the built output.',
  );

  const manifestHref = /<link[^>]+rel=["']manifest["'][^>]*>/i.exec(html)?.[0].match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  add(
    'manifest-link',
    'Manifest linked from the page',
    10,
    manifestHref ? 'pass' : 'fail',
    manifestHref ? `Linked as ${manifestHref}.` : 'index.html has no <link rel="manifest">.',
  );

  const { path: manifestPath, manifest } = parseManifest(files, manifestHref);
  const manifestExists = manifestPath in files;
  const missing: string[] = [];
  if (!manifest) {
    add(
      'manifest-fields',
      'Manifest has required fields',
      15,
      'fail',
      manifestExists ? `${manifestPath} is not valid JSON.` : 'No manifest file found.',
    );
  } else {
    if (typeof manifest.name !== 'string' && typeof manifest.short_name !== 'string') missing.push('name or short_name');
    if (typeof manifest.start_url !== 'string') missing.push('start_url');
    if (!['standalone', 'fullscreen', 'minimal-ui'].includes(String(manifest.display))) missing.push('display (standalone, fullscreen or minimal-ui)');
    add(
      'manifest-fields',
      'Manifest has required fields',
      15,
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? 'name, start_url and display are set.' : `Missing: ${missing.join(', ')}.`,
    );
    const colorsOk = typeof manifest.theme_color === 'string' && typeof manifest.background_color === 'string';
    add(
      'manifest-colors',
      'Theme and background colours',
      3,
      colorsOk ? 'pass' : 'warn',
      colorsOk ? 'Both set.' : 'Set theme_color and background_color for a native-feeling splash screen.',
    );
  }

  const icons = iconList(manifest);
  const has192 = icons.some((icon) => hasSize(icon, 192));
  const has512 = icons.some((icon) => hasSize(icon, 512));
  add(
    'manifest-icons',
    '192px and 512px icons declared',
    10,
    has192 && has512 ? 'pass' : 'fail',
    has192 && has512 ? 'Both sizes declared.' : `Declare ${[!has192 && '192x192', !has512 && '512x512'].filter(Boolean).join(' and ')} icons.`,
  );

  const normalise = (src: string) => src.replace(/^\.?\//, '').replace(/^\/+/, '').split(/[?#]/)[0];
  const missingFiles = icons.map((icon) => normalise(icon.src)).filter((src) => !/^https?:/i.test(src) && !(src in files));
  add(
    'icon-files',
    'Icon files exist in the output',
    10,
    icons.length > 0 && missingFiles.length === 0 ? 'pass' : 'fail',
    icons.length === 0 ? 'No icons to check.' : missingFiles.length === 0 ? 'All declared icons are present.' : `Missing files: ${[...new Set(missingFiles)].join(', ')}. Upload real PNG icons.`,
  );
  add(
    'maskable-icon',
    'Maskable icon (Android)',
    3,
    icons.some((icon) => (icon.purpose ?? '').includes('maskable')) ? 'pass' : 'warn',
    'A maskable icon prevents Android from shrinking your icon into a white circle.',
  );

  const swFile = files[SERVICE_WORKER_PATH] ?? files['service-worker.js'];
  const swText = swFile ? toText(swFile) : '';
  const registered = /serviceWorker\.register\(/.test(html) || /serviceWorker\.register\(/.test(Object.values(files).filter((f) => f.length < 400_000).map(toText).join('\n'));
  const hasFetch = /addEventListener\(\s*['"]fetch['"]/.test(swText);
  add(
    'service-worker',
    'Service worker registered with a fetch handler',
    15,
    swFile && registered && hasFetch ? 'pass' : 'fail',
    !swFile ? 'No service worker file (sw.js).' : !registered ? 'Service worker is never registered.' : !hasFetch ? 'Service worker has no fetch handler.' : 'Registered and handles fetch.',
  );

  const offlinePage = files['offline.html'];
  const precached = Boolean(offlinePage) && /offline\.html/.test(swText);
  add(
    'offline',
    'Offline fallback page',
    8,
    offlinePage && precached ? 'pass' : 'warn',
    offlinePage ? (precached ? 'offline.html is precached.' : 'offline.html exists but the service worker does not use it.') : 'No offline.html; offline navigations show the browser error page.',
  );

  add(
    'viewport',
    'Viewport meta tag',
    3,
    /<meta[^>]+name=["']viewport["']/i.test(html) ? 'pass' : 'warn',
    'Required for a mobile layout.',
  );
  add(
    'theme-color',
    'theme-color meta tag',
    3,
    /<meta[^>]+name=["']theme-color["']/i.test(html) ? 'pass' : 'warn',
    'Colours the browser/app chrome.',
  );
  add(
    'apple-touch-icon',
    'iOS home-screen icon',
    3,
    /<link[^>]+rel=["']apple-touch-icon["']/i.test(html) ? 'pass' : 'warn',
    'iOS ignores the manifest icons for the home screen.',
  );

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight * 0.4 : 0), 0);
  return {
    score: Math.round((earned / total) * 100),
    checks,
    installable: checks.every((c) => !BLOCKING.has(c.id) || c.status === 'pass'),
  };
}

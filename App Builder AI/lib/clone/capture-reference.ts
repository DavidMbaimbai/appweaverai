/**
 * lib/clone/capture-reference.ts
 *
 * Captures a live URL into a faithful, self-contained static snapshot plus the
 * reference data the agent needs (screenshots, section map, design tokens).
 *
 * Deps: npm i playwright pngjs && npm i -D @types/pngjs && npx playwright install chromium
 *
 * Output layout (outDir):
 *   snapshot/index.html          rendered DOM, scripts removed, URLs rewritten
 *   snapshot/assets/*            css, images, fonts, media (CSS urls rewritten)
 *   reference/<viewport>.png     full-page screenshots
 *   manifest.json                ReferenceManifest
 *
 * Seed the artifact workspace with snapshot/* BEFORE the agent runs, so the
 * agent edits a near-identical copy instead of recreating the site.
 */
import { chromium, type Page } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
export type ViewportName = (typeof VIEWPORTS)[number]['name'];

export interface ReferenceSection {
  index: number;
  tag: string;
  selector: string;
  top: number;
  height: number;
  text: string;
  /** Only stored for the desktop viewport (already rewritten to local assets). */
  html?: string;
}

export interface ReferenceTokens {
  samples: Record<string, Record<string, string> | null>;
  textColors: string[];
  backgroundColors: string[];
  fontFamilies: string[];
}

export interface ReferenceManifest {
  url: string;
  capturedAt: string;
  warnings: string[];
  tokens: ReferenceTokens;
  viewports: Record<
    string,
    {
      width: number;
      height: number;
      pageHeight: number;
      screenshot: string; // relative to outDir
      sections: ReferenceSection[];
    }
  >;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CT_EXT: Record<string, string> = {
  'text/css': '.css',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'font/woff2': '.woff2',
  'font/woff': '.woff',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'application/font-woff2': '.woff2',
  'application/font-woff': '.woff',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

function localName(url: string, contentType: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 10);
  const m = new URL(url).pathname.match(
    /\.(css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm)$/i,
  );
  const ext = m ? `.${m[1].toLowerCase()}` : (CT_EXT[contentType.split(';')[0].trim()] ?? '.bin');
  return `${hash}${ext}`;
}

// ---------- shared page helpers (also used by compare-to-reference) ----------

export async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const timer = setInterval(() => {
        window.scrollTo(0, y);
        y += step;
        if (y >= document.documentElement.scrollHeight + step) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 120);
    });
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
}

/** Deterministic screenshots: no running animations/transitions. */
export async function freezeAnimations(page: Page) {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}',
  });
}

export function cropPng(png: PNG, top: number, height: number): PNG {
  const y0 = Math.max(0, Math.min(top, png.height - 1));
  const h = Math.max(1, Math.min(height, png.height - y0));
  const out = new PNG({ width: png.width, height: h });
  PNG.bitblt(png, out, 0, y0, png.width, h, 0, 0);
  return out;
}

// ---------- in-page extraction (runs inside Chromium) ----------

interface PageDataArgs {
  map: Record<string, string>; // absolute url -> local asset filename
  rewrite: boolean;
  withHtml: boolean;
}

function extractInPage(args: PageDataArgs) {
  const { map, rewrite, withHtml } = args;

  const abs = (u: string) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return u;
    }
  };
  const local = (u: string) => {
    if (!u || u.startsWith('data:') || u.startsWith('#') || u.startsWith('blob:')) return u;
    const a = abs(u);
    return map[a] ? `assets/${map[a]}` : a;
  };
  const rewriteCss = (css: string) =>
    css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, q: string, u: string) =>
      /^(data:|#|blob:)/.test(u) ? m : `url(${q}${local(u)}${q})`,
    );
  const rewriteSrcset = (s: string) =>
    s
      .split(',')
      .map((c) => {
        const [u, ...rest] = c.trim().split(/\s+/);
        return [local(u), ...rest].join(' ');
      })
      .join(', ');

  if (rewrite) {
    document
      .querySelectorAll(
        'script, noscript, link[rel~="preload"], link[rel~="prefetch"], link[rel~="modulepreload"], meta[http-equiv="refresh"]',
      )
      .forEach((n) => n.remove());
    document
      .querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"], link[rel~="icon"]')
      .forEach((l) => l.setAttribute('href', local(l.getAttribute('href') ?? '')));
    document.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      const cur = img.currentSrc || img.getAttribute('src') || '';
      if (cur) img.setAttribute('src', local(cur));
      const ss = img.getAttribute('srcset');
      if (ss) img.setAttribute('srcset', rewriteSrcset(ss));
      img.removeAttribute('loading');
    });
    document.querySelectorAll('source').forEach((s) => {
      const ss = s.getAttribute('srcset');
      if (ss) s.setAttribute('srcset', rewriteSrcset(ss));
      const src = s.getAttribute('src');
      if (src) s.setAttribute('src', local(src));
    });
    document.querySelectorAll('video').forEach((v) => {
      const p = v.getAttribute('poster');
      if (p) v.setAttribute('poster', local(p));
      const s = v.getAttribute('src');
      if (s) v.setAttribute('src', local(s));
    });
    document.querySelectorAll<HTMLElement>('[style*="url("]').forEach((el) => {
      el.setAttribute('style', rewriteCss(el.getAttribute('style') ?? ''));
    });
    document.querySelectorAll('style').forEach((st) => {
      st.textContent = rewriteCss(st.textContent ?? '');
    });
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const h = a.getAttribute('href') ?? '';
      if (!/^(#|mailto:|tel:|javascript:)/.test(h)) a.setAttribute('href', abs(h));
    });
  }

  // ---- sections ----
  const visibleKids = (el: Element) =>
    Array.from(el.children).filter((c) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return r.height >= 40 && cs.display !== 'none' && cs.position !== 'fixed';
    });
  let container: Element = document.body;
  for (let i = 0; i < 3; i++) {
    const kids = visibleKids(container);
    if (kids.length <= 2) {
      const big = kids.sort(
        (a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height,
      )[0];
      if (big && big.children.length > 1) {
        container = big;
        continue;
      }
    }
    break;
  }
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const parent: Element | null = cur.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 1;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
      cur = parent;
    }
    return parts.join(' > ');
  };
  const sections = visibleKids(container).map((el, index) => {
    const r = el.getBoundingClientRect();
    return {
      index,
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      top: Math.round(r.top + window.scrollY),
      height: Math.round(r.height),
      text: ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      html: withHtml ? el.outerHTML.slice(0, 30000) : undefined,
    };
  });

  // ---- tokens ----
  const pick = (sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      color: s.color,
      backgroundColor: s.backgroundColor,
      borderRadius: s.borderRadius,
    };
  };
  const samples: Record<string, Record<string, string> | null> = {};
  for (const sel of ['body', 'h1', 'h2', 'h3', 'p', 'a', 'button', 'nav a', 'footer']) {
    samples[sel] = pick(sel);
  }
  const bgCount = new Map<string, number>();
  const fgCount = new Map<string, number>();
  const fonts = new Map<string, number>();
  Array.from(document.querySelectorAll('body *'))
    .slice(0, 3000)
    .forEach((el) => {
      const s = getComputedStyle(el);
      if (s.backgroundColor !== 'rgba(0, 0, 0, 0)')
        bgCount.set(s.backgroundColor, (bgCount.get(s.backgroundColor) ?? 0) + 1);
      fgCount.set(s.color, (fgCount.get(s.color) ?? 0) + 1);
      fonts.set(s.fontFamily, (fonts.get(s.fontFamily) ?? 0) + 1);
    });
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  return {
    html: rewrite ? '<!DOCTYPE html>\n' + document.documentElement.outerHTML : '',
    sections,
    pageHeight: document.documentElement.scrollHeight,
    bodyTextLength: ((document.body as HTMLElement).innerText ?? '').trim().length,
    tokens: {
      samples,
      textColors: top(fgCount, 8),
      backgroundColors: top(bgCount, 8),
      fontFamilies: top(fonts, 5),
    },
  };
}

// ---------- main entry ----------

export async function captureReference({
  url,
  outDir,
}: {
  url: string;
  outDir: string;
}): Promise<ReferenceManifest> {
  const snapDir = path.join(outDir, 'snapshot');
  const assetDir = path.join(snapDir, 'assets');
  const refDir = path.join(outDir, 'reference');
  await Promise.all([mkdir(assetDir, { recursive: true }), mkdir(refDir, { recursive: true })]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: UA, deviceScaleFactor: 1 });
  const warnings: string[] = [];
  const assets = new Map<string, { name: string; type: string; body: Buffer }>();

  context.on('response', async (res) => {
    try {
      const type = res.request().resourceType();
      if (!['stylesheet', 'image', 'font', 'media'].includes(type) || !res.ok()) return;
      const u = res.url();
      if (u.startsWith('data:') || assets.has(u)) return;
      const body = await res.body();
      const contentType = res.headers()['content-type'] ?? '';
      assets.set(u, { name: localName(u, contentType), type, body });
    } catch {
      /* ignore individual asset failures */
    }
  });

  const manifest: ReferenceManifest = {
    url,
    capturedAt: new Date().toISOString(),
    warnings,
    tokens: { samples: {}, textColors: [], backgroundColors: [], fontFamilies: [] },
    viewports: {},
  };

  let snapshotHtml = '';
  try {
    // Desktop LAST so the asset map already contains assets seen on mobile/tablet.
    for (const vp of [...VIEWPORTS].reverse()) {
      const page = await context.newPage();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      let status = 0;
      try {
        const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        status = res?.status() ?? 0;
      } catch {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        status = res?.status() ?? 0;
        warnings.push(`${vp.name}: network never went idle; capture may be incomplete.`);
      }
      if (status >= 400) warnings.push(`${vp.name}: server responded ${status} (possible bot block).`);
      await autoScroll(page);
      await page.waitForTimeout(500); // let late responses land in `assets`

      const isDesktop = vp.name === 'desktop';
      const map = Object.fromEntries([...assets].map(([u, a]) => [u, a.name]));
      const data = await page.evaluate(extractInPage, {
        map,
        rewrite: isDesktop,
        withHtml: isDesktop,
      });
      if (data.bodyTextLength < 200)
        warnings.push(`${vp.name}: very little text rendered; the site may be blocked or need interaction.`);
      if (isDesktop) {
        snapshotHtml = data.html;
        manifest.tokens = data.tokens;
      }

      await freezeAnimations(page);
      const shotRel = path.join('reference', `${vp.name}.png`);
      await page.screenshot({ path: path.join(outDir, shotRel), fullPage: true });
      manifest.viewports[vp.name] = {
        width: vp.width,
        height: vp.height,
        pageHeight: data.pageHeight,
        screenshot: shotRel,
        sections: data.sections,
      };
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ---- write assets; rewrite url()/@import inside CSS to sibling filenames ----
  const nameFor = (raw: string, base: string): string | null => {
    if (/^(data:|#|blob:)/.test(raw)) return null;
    try {
      const a = assets.get(new URL(raw, base).href);
      return a ? a.name : new URL(raw, base).href;
    } catch {
      return null;
    }
  };
  for (const [assetUrl, a] of assets) {
    let body: Buffer | string = a.body;
    if (a.type === 'stylesheet') {
      let css = a.body.toString('utf8');
      css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, q: string, u: string) => {
        const n = nameFor(u, assetUrl);
        return n ? `url(${q}${n}${q})` : m;
      });
      css = css.replace(/@import\s+(?:url\()?\s*(['"])(.*?)\1\s*\)?/g, (m, q: string, u: string) => {
        const n = nameFor(u, assetUrl);
        return n ? `@import ${q}${n}${q}` : m;
      });
      body = css;
    }
    await writeFile(path.join(assetDir, a.name), body);
  }
  await writeFile(path.join(snapDir, 'index.html'), snapshotHtml);
  const missing = Object.values(manifest.viewports).length === 0;
  if (missing) warnings.push('No viewports captured.');
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// ---------- helpers for the agent tools ----------

export async function readManifest(outDir: string): Promise<ReferenceManifest> {
  return JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
}

export async function readReferenceSection(
  outDir: string,
  viewport: ViewportName,
  index: number,
) {
  const manifest = await readManifest(outDir);
  const vp = manifest.viewports[viewport];
  const section = vp?.sections[index];
  if (!section) throw new Error(`No section ${index} for viewport "${viewport}".`);
  const png = PNG.sync.read(await readFile(path.join(outDir, vp.screenshot)));
  const crop = cropPng(png, section.top, section.height);
  return { section, screenshotBase64: PNG.sync.write(crop).toString('base64') };
}

/** Text injected into the system prompt as `referenceContext`. */
export function formatReferenceContext(m: ReferenceManifest): string {
  const d = m.viewports['desktop'];
  const outline = (d?.sections ?? [])
    .map((s) => `${s.index}. <${s.tag}> y=${s.top} h=${s.height} — ${s.text}`)
    .join('\n');
  return [
    `REFERENCE CAPTURED FROM: ${m.url} (at ${m.capturedAt})`,
    'The artifact workspace was pre-seeded with a faithful snapshot of the reference (index.html + assets/). It already renders almost identically. Your job is to edit it, not recreate it.',
    `Desktop page height: ${d?.pageHeight}px. Sections (desktop):\n${outline}`,
    `Design tokens:\n${JSON.stringify(m.tokens, null, 2)}`,
    m.warnings.length ? `Capture warnings:\n- ${m.warnings.join('\n- ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * lib/design-import/browser-capture.ts  (drop-in replacement for captureWebsiteReference)
 *
 * What it does, per job:
 *  - validates the URL and EVERY request (redirects, subresources) against an SSRF guard
 *  - uses one pooled browser + an isolated incognito context per job, with a concurrency limit
 *  - captures 3 viewports: full-page screenshot, per-section screenshots (desktop + mobile)
 *  - extracts frequency/area-ranked design tokens, a section map, headings, CSS variables
 *  - downloads assets and produces a self-contained snapshot (index.html + assets/)
 *  - reports warnings (blocked, partial, oversized) instead of failing silently
 *  - writes everything through a pluggable storage (disk by default, S3/R2 in production)
 *
 * Needs: puppeteer >= 22 (createBrowserContext). Run inside a container, see notes in the reply.
 */
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isPrivateIp, normalizeWebsiteUrl } from './url';
import { type DesignSpec, emptySpec, type ReferenceContext } from './types';

/* ----------------------------- config ----------------------------- */

const CFG = {
  maxConcurrent: Number(process.env.CAPTURE_MAX_CONCURRENT ?? 2),
  navTimeoutMs: 30_000,
  jobTimeoutMs: 120_000,
  maxAssetBytes: 8 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  maxAssets: 500,
  maxShotHeight: 16_000, // Chrome fails on taller textures
  maxSectionShotHeight: 4_000,
  maxSectionShots: 12,
  // Be honest about who is fetching. Some sites will block this; that is reported, not bypassed.
  userAgent:
    process.env.CAPTURE_USER_AGENT ??
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AppWeaverCapture/1.0',
  viewports: [
    { name: 'desktop', width: 1440, height: 900, sectionShots: true },
    { name: 'tablet', width: 768, height: 1024, sectionShots: false },
    { name: 'mobile', width: 390, height: 844, sectionShots: true },
  ],
} as const;
type Viewport = (typeof CFG.viewports)[number];

const TRACKER_RE =
  /(google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|segment\.io|clarity\.ms|intercom|hs-scripts|sentry\.io)/i;

/* ----------------------------- storage ---------------------------- */

export interface CaptureStorage {
  /** Returns a reference (path or URL) usable later to read the object back. */
  put(key: string, body: Buffer | string, contentType: string): Promise<string>;
}

export function diskStorage(root: string): CaptureStorage {
  return {
    async put(key, body) {
      const file = path.join(root, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      return file;
    },
  };
}

export interface CaptureOptions {
  jobId?: string;
  storage?: CaptureStorage;
}

/* --------------------------- SSRF guard --------------------------- */

const dnsCache = new Map<string, { ok: boolean; at: number }>();

export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('Only ports 80/443 are allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error('Internal hosts are not allowed.');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('That address is not a public website.');
    return u;
  }
  const hit = dnsCache.get(host);
  if (hit && Date.now() - hit.at < 60_000) {
    if (!hit.ok) throw new Error('That address is not a public website.');
    return u;
  }
  const addrs = await lookup(host, { all: true });
  const ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  dnsCache.set(host, { ok, at: Date.now() });
  if (!ok) throw new Error('That address is not a public website.');
  return u;
}

/* -------------------- browser pool + concurrency ------------------- */

let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const args = ['--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-extensions'];
    // Only inside a locked-down container where the container IS the sandbox.
    if (process.env.CAPTURE_NO_SANDBOX === '1') args.push('--no-sandbox', '--disable-setuid-sandbox');
    browserPromise = puppeteer.launch({ headless: true, args }).then((b) => {
      b.on('disconnected', () => {
        browserPromise = null;
      });
      return b;
    });
  }
  return browserPromise;
}

class Semaphore {
  private waiters: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
  }
  release() {
    this.active--;
    this.waiters.shift()?.();
  }
}
const slots = new Semaphore(CFG.maxConcurrent);

/* ---------------------------- job state ---------------------------- */

interface Asset {
  name: string;
  type: string;
  body: Buffer;
}
interface CaptureState {
  assets: Map<string, Asset>;
  totalBytes: number;
  warnings: string[];
}

const CT_EXT: Record<string, string> = {
  'text/css': '.css', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'font/woff2': '.woff2',
  'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'video/mp4': '.mp4', 'video/webm': '.webm',
};
function assetName(url: string, contentType: string) {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 10);
  const m = new URL(url).pathname.match(/\.(css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm)$/i);
  return hash + (m ? `.${m[1].toLowerCase()}` : (CT_EXT[contentType.split(';')[0].trim()] ?? '.bin'));
}

/** Request filtering, asset collection and page hardening. */
async function guardPage(page: Page, state: CaptureState) {
  await page.setUserAgent(CFG.userAgent);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);

  page.on('request', async (req) => {
    if (req.isInterceptResolutionHandled()) return;
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return req.continue();
    try {
      await assertPublicUrl(url); // runs on every redirect hop and subresource too
      const type = req.resourceType();
      if (type === 'websocket' || type === 'eventsource' || TRACKER_RE.test(url)) return req.abort('blockedbyclient');
      return req.continue();
    } catch {
      return req.abort('blockedbyclient');
    }
  });

  page.on('response', async (res) => {
    const type = res.request().resourceType();
    if (!['stylesheet', 'image', 'font', 'media'].includes(type) || !res.ok()) return;
    const url = res.url();
    if (url.startsWith('data:') || state.assets.has(url) || state.assets.size >= CFG.maxAssets) return;
    const declared = Number(res.headers()['content-length'] ?? 0);
    if (declared > CFG.maxAssetBytes) {
      state.warnings.push(`Skipped oversized asset: ${url.slice(0, 120)}`);
      return;
    }
    try {
      const body = Buffer.from(await res.buffer());
      if (body.length > CFG.maxAssetBytes || state.totalBytes + body.length > CFG.maxTotalBytes) {
        state.warnings.push(`Skipped asset over the size budget: ${url.slice(0, 120)}`);
        return;
      }
      state.totalBytes += body.length;
      state.assets.set(url, { name: assetName(url, res.headers()['content-type'] ?? ''), type, body });
    } catch {
      /* redirect/aborted responses have no body */
    }
  });
}

/* ------------------------- in-page functions ------------------------ */
// NOTE: these are serialized into the page. They must not reference module scope.
// If your bundler adds `__name` helpers (esbuild keepNames) and you see
// "__name is not defined", disable keepNames or pass these as strings.

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const t = setInterval(() => {
        window.scrollTo(0, y);
        y += step;
        if (y >= document.documentElement.scrollHeight + step || y > 40_000) {
          clearInterval(t);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 120);
    });
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await new Promise((r) => setTimeout(r, 400));
}

function freezePage() {
  const s = document.createElement('style');
  s.id = '__aw_freeze';
  s.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
  document.head.appendChild(s);
}

function extractDesign() {
  const toHex = (c: string): string | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    const [r, g, b] = p;
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0 || [r, g, b].some(Number.isNaN)) return null;
    return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  };
  const bump = (m: Map<string, number>, k: string | null, w = 1) => {
    if (k) m.set(k, (m.get(k) ?? 0) + w);
  };
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  const bg = new Map<string, number>(), fg = new Map<string, number>(), fonts = new Map<string, number>();
  const sizes = new Map<string, number>(), weights = new Map<string, number>(), spacing = new Map<string, number>();
  const radii = new Map<string, number>(), shadows = new Map<string, number>();

  const els = Array.from(document.body.querySelectorAll('*')).slice(0, 4000);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    bump(bg, toHex(cs.backgroundColor), Math.min(r.width * r.height, 3_000_000));
    const textLen = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim().length;
    if (textLen > 0) {
      bump(fg, toHex(cs.color), textLen);
      bump(fonts, cs.fontFamily.split(',')[0].trim().replace(/['"]/g, ''), textLen);
      bump(sizes, cs.fontSize, textLen);
      bump(weights, cs.fontWeight, textLen);
    }
    for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'] as const) {
      const v = parseFloat(cs[prop]);
      if (v > 0 && v <= 200) bump(spacing, String(Math.round(v)));
    }
    if (cs.borderTopLeftRadius !== '0px') bump(radii, cs.borderTopLeftRadius);
    if (cs.boxShadow !== 'none') bump(shadows, cs.boxShadow);
  }

  const cssVariables: Record<string, string> = {};
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && /^(:root|html|body)$/.test(rule.selectorText)) {
        for (const name of Array.from(rule.style)) {
          if (name.startsWith('--') && Object.keys(cssVariables).length < 60)
            cssVariables[name] = rule.style.getPropertyValue(name).trim();
        }
      }
    }
  }

  // Sections: visible children of body, descending through single wrapper elements.
  const visibleKids = (el: Element) =>
    Array.from(el.children).filter((c) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return r.height >= 40 && cs.display !== 'none' && cs.position !== 'fixed';
    });
  let container: Element = document.body;
  for (let i = 0; i < 3; i++) {
    const kids = visibleKids(container);
    const big = [...kids].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (kids.length <= 2 && big && big.children.length > 1) container = big;
    else break;
  }
  const sections = visibleKids(container).map((el, i) => {
    const r = el.getBoundingClientRect();
    const cls = (el.getAttribute('class') ?? '').split(/\s+/)[0];
    return {
      id: el.id || `section-${i}`,
      name: el.tagName.toLowerCase() + (cls ? `.${cls}` : ''),
      tag: el.tagName.toLowerCase(),
      text: ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      rect: { x: Math.round(r.x), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) },
    };
  });

  const bodyText = (document.body.innerText ?? '').trim();
  return {
    title: document.title,
    pageHeight: document.documentElement.scrollHeight,
    textLength: bodyText.length,
    looksBlocked:
      bodyText.length < 1500 && /(verify you are (a )?human|captcha|access denied|unusual traffic|enable javascript)/i.test(bodyText),
    hasPassword: !!document.querySelector('input[type="password"]'),
    hasPayment: !!document.querySelector('input[autocomplete^="cc-"], input[name*="card" i]'),
    headings: Array.from(document.querySelectorAll('h1,h2,h3'))
      .map((h) => `${h.tagName.toLowerCase()}: ${(h as HTMLElement).innerText.trim().slice(0, 120)}`)
      .slice(0, 20),
    sections,
    tokens: {
      backgroundColors: top(bg, 8),
      textColors: top(fg, 6),
      fonts: top(fonts, 5),
      fontSizes: top(sizes, 8),
      fontWeights: top(weights, 4),
      spacing: top(spacing, 8).map(Number).sort((a, b) => a - b).map((n) => `${n}px`),
      borderRadius: top(radii, 5),
      shadows: top(shadows, 3),
      cssVariables,
    },
  };
}

/** Desktop only, after screenshots: mutates the DOM into a self-contained snapshot. */
function buildSnapshot(map: Record<string, string>) {
  document.getElementById('__aw_freeze')?.remove();
  const abs = (u: string) => {
    try { return new URL(u, document.baseURI).href; } catch { return u; }
  };
  const local = (u: string) => {
    if (!u || /^(data:|#|blob:)/.test(u)) return u;
    const a = abs(u);
    return map[a] ? `assets/${map[a]}` : a;
  };
  const css = (t: string) =>
    t.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, q: string, u: string) =>
      /^(data:|#|blob:)/.test(u) ? m : `url(${q}${local(u)}${q})`);
  const srcset = (s: string) =>
    s.split(',').map((c) => { const [u, ...rest] = c.trim().split(/\s+/); return [local(u), ...rest].join(' '); }).join(', ');

  document.querySelectorAll('script, noscript, link[rel~="preload"], link[rel~="prefetch"], link[rel~="modulepreload"], meta[http-equiv="refresh"]').forEach((n) => n.remove());
  document.querySelectorAll('link[rel~="stylesheet"], link[rel~="icon"]').forEach((l) => l.setAttribute('href', local(l.getAttribute('href') ?? '')));
  document.querySelectorAll('img').forEach((img) => {
    const cur = img.currentSrc || img.getAttribute('src') || '';
    if (cur) img.setAttribute('src', local(cur));
    const ss = img.getAttribute('srcset');
    if (ss) img.setAttribute('srcset', srcset(ss));
    img.removeAttribute('loading');
  });
  document.querySelectorAll('source').forEach((s) => {
    const ss = s.getAttribute('srcset');
    if (ss) s.setAttribute('srcset', srcset(ss));
    const src = s.getAttribute('src');
    if (src) s.setAttribute('src', local(src));
  });
  document.querySelectorAll('video').forEach((v) => {
    const p = v.getAttribute('poster');
    if (p) v.setAttribute('poster', local(p));
  });
  document.querySelectorAll('[style*="url("]').forEach((el) => el.setAttribute('style', css(el.getAttribute('style') ?? '')));
  document.querySelectorAll('style').forEach((st) => { st.textContent = css(st.textContent ?? ''); });
  document.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href') ?? '';
    if (!/^(#|mailto:|tel:|javascript:)/.test(h)) a.setAttribute('href', abs(h));
  });
  // Phishing protection: captured forms can never post anywhere.
  document.querySelectorAll('form').forEach((f) => {
    f.removeAttribute('action');
    f.setAttribute('onsubmit', 'return false;');
    f.setAttribute('data-neutralized', 'true');
  });
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

/* --------------------------- per-viewport pass --------------------------- */

interface PassResult {
  extracted: ReturnType<typeof extractDesign>;
  fullShot: string;
  sectionShots: string[];
  snapshotHtml?: string;
}

async function capturePass(
  context: BrowserContext,
  url: string,
  vp: Viewport,
  state: CaptureState,
  storage: CaptureStorage,
  jobId: string,
): Promise<PassResult> {
  const page = await context.newPage();
  try {
    await guardPage(page, state);
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

    let status = 0;
    try {
      status = (await page.goto(url, { waitUntil: 'networkidle2', timeout: CFG.navTimeoutMs }))?.status() ?? 0;
    } catch {
      state.warnings.push(`${vp.name}: page never went idle; capture may be incomplete.`);
      status = (await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.navTimeoutMs }))?.status() ?? 0;
    }
    if (status === 401 || status === 403 || status === 429 || status === 451 || status === 999 || status >= 500)
      state.warnings.push(`${vp.name}: server responded ${status} (blocked or unavailable).`);

    await autoScroll(page);
    await page.evaluate(freezePage);
    const extracted = await page.evaluate(extractDesign);
    if (extracted.looksBlocked) state.warnings.push(`${vp.name}: page looks like a bot wall or needs JavaScript interaction.`);
    else if (extracted.textLength < 200) state.warnings.push(`${vp.name}: very little text rendered.`);
    if (extracted.pageHeight > CFG.maxShotHeight) state.warnings.push(`${vp.name}: page is ${extracted.pageHeight}px tall; screenshot truncated to ${CFG.maxShotHeight}px.`);

    const shot = async (y: number, height: number) =>
      Buffer.from(
        await page.screenshot({
          type: 'png',
          captureBeyondViewport: true,
          clip: { x: 0, y, width: vp.width, height: Math.max(1, height) },
        }),
      );

    const fullShot = await storage.put(
      `${jobId}/reference/${vp.name}.png`,
      await shot(0, Math.min(extracted.pageHeight, CFG.maxShotHeight)),
      'image/png',
    );

    const sectionShots: string[] = [];
    if (vp.sectionShots) {
      for (const [i, s] of extracted.sections.slice(0, CFG.maxSectionShots).entries()) {
        if (s.rect.y >= CFG.maxShotHeight) {
          sectionShots.push('');
          continue;
        }
        const buf = await shot(s.rect.y, Math.min(s.rect.height, CFG.maxSectionShotHeight));
        sectionShots.push(await storage.put(`${jobId}/reference/${vp.name}-section-${i}.png`, buf, 'image/png'));
      }
    }

    let snapshotHtml: string | undefined;
    if (vp.name === 'desktop') {
      await new Promise((r) => setTimeout(r, 500)); // let late asset responses land
      const map = Object.fromEntries([...state.assets].map(([u, a]) => [u, a.name]));
      snapshotHtml = await page.evaluate(buildSnapshot, map);
    }
    return { extracted, fullShot, sectionShots, snapshotHtml };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/* ------------------------------- main ------------------------------- */

async function writeSnapshot(state: CaptureState, html: string, storage: CaptureStorage, jobId: string) {
  const nameFor = (raw: string, base: string): string | null => {
    if (/^(data:|#|blob:)/.test(raw)) return null;
    try {
      const abs = new URL(raw, base).href;
      return state.assets.get(abs)?.name ?? abs;
    } catch {
      return null;
    }
  };
  for (const [assetUrl, a] of state.assets) {
    let body: Buffer | string = a.body;
    if (a.type === 'stylesheet') {
      body = a.body
        .toString('utf8')
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, q: string, u: string) => {
          const n = nameFor(u, assetUrl);
          return n ? `url(${q}${n}${q})` : m;
        })
        .replace(/@import\s+(?:url\()?\s*(['"])(.*?)\1\s*\)?/g, (m, q: string, u: string) => {
          const n = nameFor(u, assetUrl);
          return n ? `@import ${q}${n}${q}` : m;
        });
    }
    await storage.put(`${jobId}/snapshot/assets/${a.name}`, body, 'application/octet-stream');
  }
  return storage.put(`${jobId}/snapshot/index.html`, html, 'text/html');
}

export async function captureWebsiteReference(urlStr: string, opts: CaptureOptions = {}): Promise<DesignSpec> {
  const initial = normalizeWebsiteUrl(urlStr);
  if (!initial) throw new Error('Enter a public https:// website URL.');
  const url = await assertPublicUrl(initial);
  const jobId = opts.jobId ?? randomUUID();
  const storage = opts.storage ?? diskStorage(process.env.CAPTURE_DIR ?? path.join(os.tmpdir(), 'aw-captures'));

  await slots.acquire();
  const browser = await getBrowser();
  const context = await browser.createBrowserContext(); // isolated cookies/storage per job
  // Hard job deadline: closing the context aborts every pending operation.
  const killer = setTimeout(() => void context.close().catch(() => undefined), CFG.jobTimeoutMs);
  const state: CaptureState = { assets: new Map(), totalBytes: 0, warnings: [] };

  try {
    // Desktop last so the asset map already contains assets requested by mobile/tablet.
    const results: Record<string, PassResult> = {};
    for (const vp of [...CFG.viewports].reverse()) {
      results[vp.name] = await capturePass(context, url.href, vp, state, storage, jobId);
    }
    const desktop = results.desktop;
    const snapshotRef = await writeSnapshot(state, desktop.snapshotHtml ?? '', storage, jobId);

    const t = desktop.extracted.tokens;
    const reference = {
      designTokens: {
        colors: [...new Set([...t.backgroundColors, ...t.textColors])].slice(0, 10),
        fonts: t.fonts,
        spacing: t.spacing,
        borderRadius: t.borderRadius,
        // extras
        backgroundColors: t.backgroundColors,
        textColors: t.textColors,
        fontSizes: t.fontSizes,
        fontWeights: t.fontWeights,
        shadows: t.shadows,
        cssVariables: t.cssVariables,
      },
      sections: desktop.extracted.sections.map((s, i) => ({
        id: s.id,
        name: s.name,
        outline: { name: s.tag, type: 'element', text: s.text },
        rect: s.rect,
        screenshotPath: desktop.sectionShots[i] ?? '',
        mobileScreenshotPath: results.mobile.sectionShots[i] ?? '',
      })),
      viewports: Object.fromEntries(
        Object.entries(results).map(([name, r]) => [name, { pageHeight: r.extracted.pageHeight, screenshotPath: r.fullShot }]),
      ),
      snapshotPath: snapshotRef,
      jobId,
      hasPassword: desktop.extracted.hasPassword,
      hasPayment: desktop.extracted.hasPayment,
      warnings: state.warnings,
    } as unknown as ReferenceContext;

    const spec = emptySpec('url', desktop.extracted.title || url.href);
    spec.sourceUrl = url.href;
    spec.headings = desktop.extracted.headings;
    spec.referenceContext = reference;
    return spec;
  } finally {
    clearTimeout(killer);
    await context.close().catch(() => undefined);
    slots.release();
  }
}

/** Call from your worker's shutdown handler. */
export async function closeCaptureBrowser() {
  const b = await browserPromise;
  await b?.close().catch(() => undefined);
  browserPromise = null;
}

/**
 * lib/clone/capture-reference.ts
 *
 * Captures a live URL into a faithful, self-contained static snapshot plus the
 * reference data the agent needs (screenshots, section map, design tokens).
 *
 * Deps: npm i puppeteer pngjs && npm i -D @types/pngjs
 */
import puppeteer, { type Page } from 'puppeteer';
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
  await new Promise((r) => setTimeout(r, 400));
}

/** Deterministic screenshots: no running animations/transitions. */
export async function freezeAnimations() {
  const s = document.createElement('style');
  s.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
  document.head.appendChild(s);
}

export function cropPng(png: PNG, top: number, height: number): PNG {
  const y0 = Math.max(0, Math.min(top, png.height - 1));
  const h = Math.max(1, Math.min(height, png.height - y0));
  const out = new PNG({ width: png.width, height: h });
  PNG.bitblt(png, out, 0, y0, png.width, h, 0, 0);
  return out;
}

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

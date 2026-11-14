/**
 * lib/clone/compare-to-reference.ts
 *
 * Renders the artifact preview at the same viewports as the reference capture,
 * diffs it against the reference screenshots, and reports mismatch per section.
 *
 * Deps: npm i pixelmatch pngjs playwright && npm i -D @types/pngjs
 */
import { chromium, type Browser } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  VIEWPORTS,
  autoScroll,
  cropPng,
  freezeAnimations,
  readManifest,
  type ViewportName,
} from './capture-reference';

/** Completion criteria. Tune per product. */
export const DIFF_TARGET = { overall: 0.02, section: 0.05 };
export const MAX_FIX_ROUNDS = 4;

export interface SectionDiff {
  viewport: ViewportName;
  index: number;
  selector: string;
  text: string;
  top: number;
  height: number;
  mismatch: number; // 0..1
}

export interface ViewportDiff {
  viewport: ViewportName;
  overallMismatch: number;
  referenceHeight: number;
  previewHeight: number;
  heightDelta: number;
  sections: SectionDiff[];
  diffImage: string; // path to full diff png
  worstSectionDiffBase64?: string;
}

export interface CompareResult {
  passed: boolean;
  target: typeof DIFF_TARGET;
  viewports: ViewportDiff[];
  worst: SectionDiff[];
}

function padPng(src: PNG, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h }); // zeroed = transparent
  PNG.bitblt(src, out, 0, 0, src.width, src.height, 0, 0);
  return out;
}

async function renderPreview(
  browser: Browser,
  previewUrl: string,
  vp: { width: number; height: number },
): Promise<PNG> {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  try {
    const page = await context.newPage();
    try {
      await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 45000 });
    } catch {
      await page.goto(previewUrl, { waitUntil: 'load', timeout: 45000 });
    }
    await autoScroll(page);
    await freezeAnimations(page);
    return PNG.sync.read(await page.screenshot({ fullPage: true }));
  } finally {
    await context.close();
  }
}

export async function compareToReference({
  previewUrl,
  refDir,
  outDir,
  viewports = ['desktop', 'mobile'],
}: {
  previewUrl: string;
  refDir: string;
  outDir: string;
  viewports?: ViewportName[];
}): Promise<CompareResult> {
  const manifest = await readManifest(refDir);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const results: ViewportDiff[] = [];

  try {
    for (const name of viewports) {
      const cfg = VIEWPORTS.find((v) => v.name === name);
      const refMeta = manifest.viewports[name];
      if (!cfg || !refMeta) continue;

      const ref = PNG.sync.read(await readFile(path.join(refDir, refMeta.screenshot)));
      const cand = await renderPreview(browser, previewUrl, cfg);

      const w = Math.max(ref.width, cand.width);
      const h = Math.max(ref.height, cand.height);
      const a = padPng(ref, w, h);
      const b = padPng(cand, w, h);
      const diff = new PNG({ width: w, height: h });
      const opts = { threshold: 0.1, includeAA: false };
      const total = pixelmatch(a.data, b.data, diff.data, w, h, opts);

      const sections: SectionDiff[] = [];
      for (const s of refMeta.sections) {
        const top = Math.min(s.top, h - 1);
        const hgt = Math.min(s.height, h - top);
        if (hgt <= 0) continue;
        const ca = cropPng(a, top, hgt);
        const cb = cropPng(b, top, hgt);
        const d = new PNG({ width: w, height: hgt });
        const n = pixelmatch(ca.data, cb.data, d.data, w, hgt, opts);
        sections.push({
          viewport: name,
          index: s.index,
          selector: s.selector,
          text: s.text,
          top: s.top,
          height: s.height,
          mismatch: n / (w * hgt),
        });
      }

      const diffPath = path.join(outDir, `diff-${name}.png`);
      await writeFile(diffPath, PNG.sync.write(diff));

      const worstSection = [...sections].sort((x, y) => y.mismatch - x.mismatch)[0];
      results.push({
        viewport: name,
        overallMismatch: total / (w * h),
        referenceHeight: ref.height,
        previewHeight: cand.height,
        heightDelta: cand.height - ref.height,
        sections,
        diffImage: diffPath,
        worstSectionDiffBase64: worstSection
          ? PNG.sync
              .write(cropPng(diff, worstSection.top, Math.min(worstSection.height, h - worstSection.top)))
              .toString('base64')
          : undefined,
      });
    }
  } finally {
    await browser.close();
  }

  const worst = results
    .flatMap((r) => r.sections)
    .sort((x, y) => y.mismatch - x.mismatch)
    .slice(0, 5);
  const passed =
    results.length > 0 &&
    results.every(
      (r) =>
        r.overallMismatch <= DIFF_TARGET.overall &&
        r.sections.every((s) => s.mismatch <= DIFF_TARGET.section),
    );

  return { passed, target: DIFF_TARGET, viewports: results, worst };
}

/** Human/LLM-readable summary (kept short so it fits in a tool_result). */
export function summarizeCompare(r: CompareResult): string {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const lines = [
    r.passed
      ? `PASS: within target (overall ≤ ${pct(r.target.overall)}, each section ≤ ${pct(r.target.section)}).`
      : `NOT YET: target is overall ≤ ${pct(r.target.overall)} and each section ≤ ${pct(r.target.section)}.`,
    ...r.viewports.map(
      (v) =>
        `${v.viewport}: overall mismatch ${pct(v.overallMismatch)}; page height ${v.previewHeight}px vs reference ${v.referenceHeight}px (Δ ${v.heightDelta}px).`,
    ),
    'Worst sections (fix these first):',
    ...r.worst.map(
      (s) =>
        `- [${s.viewport}] section ${s.index} (y=${s.top}, h=${s.height}) ${pct(s.mismatch)} — "${s.text.slice(0, 80)}"`,
    ),
    'Tip: a large page-height delta usually means wrong spacing/line-height/image sizes above the first bad section; fix the topmost mismatch first.',
  ];
  return lines.join('\n');
}

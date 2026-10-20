import { parse } from 'node-html-parser';

import { isTestPath, type RawFinding, type ScanFile } from './types';

const HTML_FILE = /\.html?$/i;
const JSX_FILE = /\.(jsx|tsx)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|bmp|tiff?)$/i;
const MEDIA_FILE = /\.(mp4|mov|webm|avi|mkv|wav|mp3)$/i;
const KB = 1024;
const MB = 1024 * KB;

function finding(
  rule: string,
  category: 'ACCESSIBILITY' | 'PERFORMANCE',
  severity: RawFinding['severity'],
  file: string,
  line: number | null,
  title: string,
  message: string,
  snippet?: string,
): RawFinding {
  return { rule, category, severity, file, line, title, message, snippet, evidence: snippet ?? file };
}

function lineAt(content: string, index: number) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

const ARIA_NAME = /\baria-label(?:ledby)?\s*=|\btitle\s*=|\{\s*\.\.\.\w+\s*\}/i;

function tagFindings(file: string, content: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const match of content.matchAll(/<img\b(?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*>/gi)) {
    const tag = match[0];
    if (/\balt\s*=|\{\s*\.\.\.\w+\s*\}/i.test(tag)) continue;
    if (/\brole\s*=\s*["']presentation["']|aria-hidden\s*=\s*["']?true/i.test(tag)) continue;
    out.push(
      finding('a11y/img-alt', 'ACCESSIBILITY', 'LOW', file, lineAt(content, match.index ?? 0), 'Image without alt text',
        'Screen readers cannot describe this image. Add a short alt attribute (or alt="" if purely decorative).', tag.slice(0, 120)),
    );
  }
  for (const match of content.matchAll(/<button\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = match[1];
    const inner = match[2].replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
    const hasImgAlt = /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(match[2]);
    if (inner || hasImgAlt || ARIA_NAME.test(attrs)) continue;
    out.push(
      finding('a11y/button-name', 'ACCESSIBILITY', 'LOW', file, lineAt(content, match.index ?? 0), 'Button without an accessible name',
        'This button has no text, aria-label or title, so assistive technology announces it as just "button".', match[0].replace(/\s+/g, ' ').slice(0, 120)),
    );
  }
  for (const match of content.matchAll(/<a\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    if (!/\bhref\s*=/.test(attrs)) continue;
    const inner = match[2].replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
    const hasImgAlt = /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(match[2]);
    if (inner || hasImgAlt || ARIA_NAME.test(attrs)) continue;
    out.push(
      finding('a11y/link-name', 'ACCESSIBILITY', 'LOW', file, lineAt(content, match.index ?? 0), 'Link without discernible text',
        'This link has no text, aria-label or title, so its purpose cannot be announced.', match[0].replace(/\s+/g, ' ').slice(0, 120)),
    );
  }
  return out;
}

function htmlFindings(file: string, content: string): RawFinding[] {
  const out = tagFindings(file, content);
  const root = parse(content, { blockTextElements: { script: false, style: false } });
  const isDocument = /<html[\s>]/i.test(content);
  if (isDocument && !root.querySelector('html')?.getAttribute('lang')) {
    out.push(finding('a11y/html-lang', 'ACCESSIBILITY', 'LOW', file, 1, 'Page language not declared',
      'Add lang="en" (or the right language) to the <html> element so screen readers pick the correct voice.'));
  }
  for (const input of root.querySelectorAll('input, select, textarea')) {
    const type = (input.getAttribute('type') ?? 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    const id = input.getAttribute('id');
    const labelled =
      input.getAttribute('aria-label') ||
      input.getAttribute('aria-labelledby') ||
      input.getAttribute('title') ||
      (id && root.querySelector(`label[for="${id}"]`)) ||
      input.closest('label');
    if (!labelled) {
      out.push(finding('a11y/form-label', 'ACCESSIBILITY', 'LOW', file, null, 'Form field without a label',
        'A form field has no <label>, aria-label or title. A placeholder alone is not an accessible name.', input.toString().slice(0, 120)));
      break;
    }
  }
  for (const script of root.querySelectorAll('head script[src]')) {
    if (script.hasAttribute('defer') || script.hasAttribute('async') || script.getAttribute('type') === 'module') continue;
    const src = script.getAttribute('src') ?? '';
    out.push(finding('perf/render-blocking-script', 'PERFORMANCE', 'LOW', file, null, 'Render-blocking script in <head>',
      'Scripts in <head> without defer or async delay the first paint. Add defer.', src.slice(0, 120)));
    break;
  }
  const imgs = root.querySelectorAll('img');
  const noSize = imgs.filter((img) => !(img.getAttribute('width') && img.getAttribute('height')) && !/aspect-|width|height/i.test(img.getAttribute('style') ?? '') && !img.getAttribute('class'));
  if (noSize.length >= 3) {
    out.push(finding('perf/img-dimensions', 'PERFORMANCE', 'INFO', file, null, 'Images without dimensions',
      `${noSize.length} images have no width/height, which causes layout shift while they load.`));
  }
  return out;
}

export function scanQuality(file: ScanFile): RawFinding[] {
  const out: RawFinding[] = [];
  if (isTestPath(file.path)) return out;

  if (IMAGE_FILE.test(file.path) && file.size > 300 * KB) {
    out.push(finding('perf/large-image', 'PERFORMANCE', file.size > 2 * MB ? 'MEDIUM' : 'LOW', file.path, null, 'Large unoptimised image',
      `${(file.size / MB).toFixed(1)} MB. Convert to WebP/AVIF and resize to the displayed size.`, `${file.path} (${Math.round(file.size / KB)} KB)`));
  } else if (MEDIA_FILE.test(file.path) && file.size > 10 * MB) {
    out.push(finding('perf/large-media', 'PERFORMANCE', 'MEDIUM', file.path, null, 'Very large media file',
      `${(file.size / MB).toFixed(1)} MB. Compress it or stream it from a media host.`, `${file.path} (${Math.round(file.size / KB)} KB)`));
  } else if (/\.(m?js|css)$/i.test(file.path) && file.size > 1 * MB) {
    out.push(finding('perf/large-bundle', 'PERFORMANCE', 'LOW', file.path, null, 'Very large script or stylesheet',
      `${(file.size / MB).toFixed(1)} MB. Split, minify or remove unused code.`, `${file.path} (${Math.round(file.size / KB)} KB)`));
  } else if (/\.svg$/i.test(file.path) && file.size > 500 * KB) {
    out.push(finding('perf/large-svg', 'PERFORMANCE', 'LOW', file.path, null, 'Very large SVG',
      `${Math.round(file.size / KB)} KB. Optimise it (for example with SVGO) or use a raster format.`, `${file.path} (${Math.round(file.size / KB)} KB)`));
  }

  if (file.content === null) return out;
  if (HTML_FILE.test(file.path)) out.push(...htmlFindings(file.path, file.content));
  else if (JSX_FILE.test(file.path)) out.push(...tagFindings(file.path, file.content));
  return out.slice(0, 30);
}

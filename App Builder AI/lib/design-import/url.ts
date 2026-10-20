import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isSafePublicUrl } from '@/lib/outreach/compliance';
import { emptySpec, type DesignSpec } from './types';

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe[89ab])/.test(lower) || lower.startsWith('ff');
  }
  return true;
}

export function normalizeWebsiteUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isSafePublicUrl(withScheme) ? withScheme : null;
}

async function assertPublicHost(url: URL) {
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('That address is not a public website.');
  }
}

/** SSRF-safe fetch: https only, DNS-resolved public IPs, manual redirects, size cap. */
export async function fetchPublicHtml(raw: string): Promise<{ html: string; finalUrl: string }> {
  const initial = normalizeWebsiteUrl(raw);
  if (!initial) throw new Error('Enter a public https:// website URL.');
  let current: string = initial;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url: URL = new URL(current);
    if (!isSafePublicUrl(current)) throw new Error('That address is not a public website.');
    await assertPublicHost(url);

    const response: Response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'text/html', 'user-agent': 'AppWeaverDesignImport/1.0' },
    });

    if (response.status >= 300 && response.status < 400) {
      const location: string | null = response.headers.get('location');
      if (!location) throw new Error('Website redirected without a destination.');
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Website returned ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) {
      throw new Error('That URL does not return an HTML page.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return { html: Buffer.concat(chunks).toString('utf8').slice(0, MAX_HTML_BYTES), finalUrl: current };
  }
  throw new Error('Too many redirects.');
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHex(hex: string) {
  const h = hex.replace('#', '').toLowerCase();
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return `#${full.toUpperCase()}`;
}

export function extractDesignFromHtml(html: string, sourceUrl?: string): DesignSpec {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const spec = emptySpec('url', title || sourceUrl || 'Website');
  spec.sourceUrl = sourceUrl;

  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  for (const m of body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = stripTags(m[2]);
    if (text) spec.headings.push(`h${m[1]}: ${text.slice(0, 120)}`);
    if (spec.headings.length >= 25) break;
  }

  const description = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
  )?.[1];
  if (description) spec.notes.push(`Meta description: ${stripTags(description).slice(0, 200)}`);
  const themeColor = html.match(
    /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']*)["']/i,
  )?.[1];
  if (themeColor) spec.notes.push(`Theme colour: ${themeColor}`);

  const colorCounts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = normalizeHex(m[0]);
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }
  spec.colors = [...colorCounts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const fonts = new Set<string>();
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].replace(/['"]/g, '').trim();
    if (first && !/^(inherit|initial|sans-serif|serif|monospace|system-ui)$/i.test(first)) {
      fonts.add(first);
    }
  }
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&:]+)/gi)) {
    fonts.add(decodeURIComponent(m[1]).replace(/\+/g, ' '));
  }
  spec.fonts = [...fonts].slice(0, 8);
  spec.textStyles = spec.fonts.map((fontFamily) => ({ fontFamily, count: 1 }));

  const landmarks = ['header', 'nav', 'main', 'section', 'article', 'aside', 'form', 'footer'];
  const structure: string[] = [];
  for (const tag of landmarks) {
    const count = (body.match(new RegExp(`<${tag}[\\s>]`, 'gi')) ?? []).length;
    if (count > 0) structure.push(`${tag} x${count}`);
  }
  const buttons = (body.match(/<button[\s>]/gi) ?? []).length;
  const links = (body.match(/<a[\s>]/gi) ?? []).length;
  const imgs = (body.match(/<img[\s>]/gi) ?? []).length;
  structure.push(`${buttons} buttons`, `${links} links`, `${imgs} images`);
  spec.notes.push(`Page structure: ${structure.join(', ')}`);

  const navLinks = [...(body.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? '').matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean)
    .slice(0, 10);
  if (navLinks.length) spec.notes.push(`Navigation: ${navLinks.join(' | ')}`);

  return spec;
}

export async function fetchWebsiteDesign(raw: string): Promise<DesignSpec> {
  const { html, finalUrl } = await fetchPublicHtml(raw);
  return extractDesignFromHtml(html, finalUrl);
}

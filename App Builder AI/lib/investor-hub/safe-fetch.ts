import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { parse } from 'node-html-parser';

import { isSafePublicUrl } from '@/lib/outreach/compliance';

const USER_AGENT = 'AppWeaverBot/1.0 (+https://appweaverai.com)';
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
      a >= 224
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
    return lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

/** https-only, and every address the host resolves to must be public. */
export async function isSafeResolvedUrl(raw: string): Promise<boolean> {
  if (!isSafePublicUrl(raw)) return false;
  try {
    const records = await lookup(new URL(raw).hostname, { all: true });
    return records.length > 0 && records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

/** Minimal robots.txt check for our bot (groups for "*" or AppWeaverBot; longest match wins). */
export function robotsAllows(robots: string, path: string): boolean {
  const rules: Array<{ allow: boolean; prefix: string }> = [];
  let applies = false;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      const matches = value === '*' || value.toLowerCase().includes('appweaverbot');
      applies = lastWasAgent ? applies || matches : matches;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (applies && (key === 'allow' || key === 'disallow') && value) {
      rules.push({ allow: key === 'allow', prefix: value });
    }
  }
  let best: { allow: boolean; prefix: string } | null = null;
  for (const rule of rules) {
    if (path.startsWith(rule.prefix) && (!best || rule.prefix.length > best.prefix.length)) best = rule;
  }
  return best ? best.allow : true;
}

async function guardedFetch(url: string, accept: string): Promise<Response | null> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!(await isSafeResolvedUrl(current))) return null;
    const response = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      current = new URL(location, current).toString();
      continue;
    }
    return response.ok ? response : null;
  }
  return null;
}

async function allowedByRobots(url: string): Promise<boolean> {
  const target = new URL(url);
  try {
    const response = await guardedFetch(`${target.origin}/robots.txt`, 'text/plain');
    if (!response) return true;
    return robotsAllows((await response.text()).slice(0, 100_000), target.pathname + target.search);
  } catch {
    return true;
  }
}

export type FetchedPage = { url: string; text: string; links: string[] };

/** SSRF-safe, robots-respecting fetch of a public HTML page; returns readable text and same-site links. */
export async function fetchPublicPage(url: string): Promise<FetchedPage | null> {
  try {
    if (!(await allowedByRobots(url))) return null;
    const response = await guardedFetch(url, 'text/html');
    if (!response || !(response.headers.get('content-type') ?? '').includes('text/html')) return null;

    const root = parse((await response.text()).slice(0, 400_000));
    root.querySelectorAll('script, style, noscript, svg').forEach((n) => n.remove());
    const origin = new URL(url).origin;
    const links = new Set<string>();
    for (const a of root.querySelectorAll('a[href]')) {
      try {
        const href = new URL(a.getAttribute('href') ?? '', url);
        if (href.origin === origin) links.add(href.origin + href.pathname);
      } catch {
        // ignore malformed links
      }
    }
    const mailto = root
      .querySelectorAll('a[href^="mailto:"]')
      .map((a) => a.getAttribute('href')?.replace(/^mailto:/i, '').split('?')[0])
      .filter(Boolean)
      .join('\n');
    return {
      url,
      text: `${root.textContent.replace(/\s+/g, ' ').trim()}\n${mailto}`.slice(0, 15_000),
      links: [...links].slice(0, 100),
    };
  } catch {
    return null;
  }
}

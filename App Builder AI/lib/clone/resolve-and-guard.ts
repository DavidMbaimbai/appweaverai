/**
 * lib/clone/resolve-and-guard.ts
 *
 * 1) resolveReferenceIntent  - "create linkedin" / "clone stripe.com" -> candidate URL(s)
 * 2) assertPublicUrl + installRequestGuard - SSRF protection for the capture worker
 * 3) decideCloneMode - faithful vs inspired (brand / phishing policy)
 * 4) neutralizeCapturedHtml - make captured login/payment forms inert
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { BrowserContext } from 'playwright';

/* ------------------------------------------------------------------ *
 * 1) Intent resolution
 * ------------------------------------------------------------------ */

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}
/** Inject Brave / Bing / Serper / Tavily here. */
export type SearchProvider = (query: string) => Promise<SearchResult[]>;

export type ResolvedIntent =
  | { kind: 'url'; url: string }
  | { kind: 'named-site'; name: string; candidates: SearchResult[] }
  | { kind: 'none' };

const URL_RE = /\bhttps?:\/\/[^\s)]+/i;
const BARE_DOMAIN_RE = /\b([a-z0-9-]+\.)+(com|org|net|io|co|app|dev|ai|zw|za|uk|us)\b(\/[^\s]*)?/i;
const VERB_RE =
  /^\s*(?:please\s+)?(?:create|build|make|clone|copy|replicate|recreate)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:clone\s+of\s+|copy\s+of\s+|website\s+like\s+|app\s+like\s+)?(.+?)\s*$/i;

const FEATURE_KEYWORDS = /\b(with|using|that\s+has|featuring|including|supports?)\b/i;

const BLOCKED_RESULT_HOSTS =
  /(wikipedia\.org|facebook\.com|twitter\.com|x\.com|reddit\.com|youtube\.com|pinterest\.com|quora\.com)$/i;

export async function resolveReferenceIntent(
  text: string,
  search: SearchProvider,
): Promise<ResolvedIntent> {
  const url = text.match(URL_RE)?.[0];
  if (url) return { kind: 'url', url };

  const domain = text.match(BARE_DOMAIN_RE)?.[0];
  if (domain) return { kind: 'url', url: `https://${domain}` };

  const name = text.match(VERB_RE)?.[1]?.replace(/[.?!]+$/, '').trim();

  // "create a todo app with dark mode" is a normal build request, not a clone.
  // We detect feature keywords (with, using, etc.) to distinguish them.
  if (!name || name.split(/\s+/).length > 3 || FEATURE_KEYWORDS.test(name)) return { kind: 'none' };

  const results = await search(`${name} official website`);
  const candidates = results
    .filter((r) => {
      try {
        return !BLOCKED_RESULT_HOSTS.test(new URL(r.url).hostname);
      } catch {
        return false;
      }
    })
    .slice(0, 3);
  // Never auto-build from a name: the UI must show candidates and let the user confirm.
  return candidates.length ? { kind: 'named-site', name, candidates } : { kind: 'none' };
}

/* ------------------------------------------------------------------ *
 * 2) SSRF guard  (capture workers fetch arbitrary user-supplied URLs)
 * ------------------------------------------------------------------ */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIp(mapped[1]) : false;
}

const hostCache = new Map<string, boolean>();

export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Only ports 80/443 are allowed.');
  const host = u.hostname;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Internal hosts are not allowed.');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private addresses are not allowed.');
    return u;
  }
  const cached = hostCache.get(host);
  if (cached === false) throw new Error('Host resolves to a private address.');
  if (cached === undefined) {
    const addrs = await lookup(host, { all: true });
    const ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
    hostCache.set(host, ok);
    if (!ok) throw new Error('Host resolves to a private address.');
  }
  return u;
}

/**
 * Apply to the Playwright context so EVERY request (redirects, subresources,
 * iframes) is checked, not just the first URL.
 * Also enforce at the network layer: run capture workers in an isolated
 * container/VPC with egress allowed only to the public internet and the
 * metadata endpoint blocked. DNS-rebinding can only be fully closed there.
 */
export async function installRequestGuard(context: BrowserContext, maxBytes = 25 * 1024 * 1024) {
  let total = 0;
  await context.route('**/*', async (route) => {
    try {
      await assertPublicUrl(route.request().url());
    } catch {
      return route.abort('blockedbyclient');
    }
    if (total > maxBytes) return route.abort('blockedbyclient'); // runaway page budget
    const res = await route.fetch().catch(() => null);
    if (!res) return route.abort('failed');
    total += (await res.body()).length;
    return route.fulfill({ response: res });
  });
}

/* ------------------------------------------------------------------ *
 * 3) Clone policy
 * ------------------------------------------------------------------ */

export type CloneMode = 'faithful' | 'inspired';

export interface CloneDecision {
  mode: CloneMode;
  notice: string | null; // shown to the user in the UI
  swapBranding: boolean;
  neutralizeForms: boolean;
}

/**
 * faithful : pixel-level copy including logo, copy and assets
 * inspired : same layout, structure, spacing and typography scale, but the
 *            agent replaces the logo, product name and trademarked copy with
 *            placeholders (or the user's own brand)
 *
 * Default: faithful only when the user states they own the site or the URL
 * is on their verified domain. Anything else is "inspired". Login/payment
 * pages are always neutralized so a clone can never harvest credentials.
 */
export function decideCloneMode(opts: {
  userOwnsSite: boolean;
  hasPasswordField: boolean;
  hasPaymentField: boolean;
}): CloneDecision {
  const sensitive = opts.hasPasswordField || opts.hasPaymentField;
  if (opts.userOwnsSite) {
    return {
      mode: 'faithful',
      notice: sensitive ? 'Login/payment forms were disabled in the copy. Connect your own backend to enable them.' : null,
      swapBranding: false,
      neutralizeForms: sensitive,
    };
  }
  return {
    mode: 'inspired',
    notice:
      'This site belongs to someone else, so the copy keeps the layout, spacing and typography but replaces their logo, name and trademarked text with placeholders. Add your own branding, or confirm you own the site to get an exact copy.' +
      (sensitive ? ' Login/payment forms are disabled.' : ''),
    swapBranding: true,
    neutralizeForms: sensitive,
  };
}

/* ------------------------------------------------------------------ *
 * 4) Make captured forms inert (phishing protection)
 * ------------------------------------------------------------------ */

export function neutralizeCapturedHtml(html: string): string {
  let out = html
    // remove external form targets
    .replace(/(<form\b[^>]*?)\saction\s*=\s*(["']).*?\2/gi, '$1')
    .replace(/<form\b/gi, '<form action="#" onsubmit="return false;" data-neutralized="true"');
  const banner =
    '<div style="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;font:12px system-ui;padding:6px 12px;text-align:center">' +
    'Prototype copy generated for design purposes. Do not enter real passwords or payment details.</div>';
  out = out.replace(/<\/body>/i, `${banner}</body>`);
  return out;
}

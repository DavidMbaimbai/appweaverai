import { parse } from 'node-html-parser';

import { buildInventory } from '@/lib/observatory/inventory';

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_VERIFIED';

export type CheckId =
  | 'required_pages'
  | 'legal_pages'
  | 'meta_tags'
  | 'mobile_viewport'
  | 'broken_links'
  | 'live_links'
  | 'forms'
  | 'security_headers'
  | 'https'
  | 'secrets'
  | 'contact'
  | 'analytics'
  | 'payments'
  | 'smoke';

export type CheckResult = {
  id: CheckId;
  title: string;
  status: CheckStatus;
  /** What was actually inspected and found; never a claim without a source. */
  evidence: string;
  /** What the owner should do next. */
  advice?: string;
};

/** A published file; `path` is relative to the site root (no artifact slug). */
export type SiteFile = { path: string; content: string };

export type SeoHints = {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
};

export type LiveProbe =
  | {
      url: string;
      status: number;
      headers: Record<string, string>;
      brokenLinks: string[];
      linksChecked: number;
    }
  | { url: string; error: string };

export type SmokeSummary = {
  outcome: 'PASS' | 'SUSPECTED' | 'CONFIRMED_FAILURE';
  checkedAt: string;
  version: number | null;
};

export type ReadinessInput = {
  files: SiteFile[];
  seo?: SeoHints;
  /** Null when the site is not published at a public URL we may probe. */
  live: LiveProbe | null;
  smoke: SmokeSummary | null;
  liveVersion?: number | null;
};

export const CHECK_TITLES: Record<CheckId, string> = {
  required_pages: 'Required pages exist',
  legal_pages: 'Privacy policy and terms pages',
  meta_tags: 'Title, description and social tags',
  mobile_viewport: 'Mobile viewport tag',
  broken_links: 'Internal links (site files)',
  live_links: 'Internal links (live site)',
  forms: 'Forms and validation',
  security_headers: 'Security headers',
  https: 'HTTPS',
  secrets: 'Secrets in served files',
  contact: 'Contact channel',
  analytics: 'Analytics',
  payments: 'Payments',
  smoke: 'Latest smoke check',
};

const isHtml = (path: string) => /\.html?$/i.test(path);
const isText = (path: string) =>
  /\.(html?|css|js|mjs|cjs|json|txt|xml|svg|map|md|env)$/i.test(path);

function htmlPages(files: SiteFile[]) {
  return files.filter((f) => isHtml(f.path));
}

function parseHtml(html: string) {
  return parse(html, { blockTextElements: { script: false, style: false } });
}

function result(
  id: CheckId,
  status: CheckStatus,
  evidence: string,
  advice?: string,
): CheckResult {
  return { id, title: CHECK_TITLES[id], status, evidence, advice };
}

function list(items: string[], max = 5) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

function formsOf(files: SiteFile[]) {
  return htmlPages(files).flatMap((file) =>
    parseHtml(file.content)
      .querySelectorAll('form')
      .map((form) => ({ file: file.path, form })),
  );
}

export function checkRequiredPages(files: SiteFile[]): CheckResult {
  const inventory = buildInventory(
    files.map((f) => ({ path: `site/${f.path}`, content: f.content })),
  );
  if (!inventory.pages.includes('/')) {
    return result(
      'required_pages',
      'FAIL',
      `No home page (index.html) found among ${files.length} file(s).`,
      'Add an index.html home page before launching.',
    );
  }
  return result(
    'required_pages',
    'PASS',
    `Home page found. Pages detected: ${list(inventory.pages, 8)}.`,
  );
}

const PRIVACY = /privacy|datenschutz/i;
const TERMS = /terms|conditions|tos\b|agb/i;

export function checkLegalPages(files: SiteFile[]): CheckResult {
  const pages = htmlPages(files);
  const has = (pattern: RegExp) =>
    pages.some((p) => pattern.test(p.path)) ||
    pages.some((p) =>
      parseHtml(p.content)
        .querySelectorAll('a[href]')
        .some((a) => pattern.test(a.getAttribute('href') ?? '')),
    );
  const privacy = has(PRIVACY);
  const terms = has(TERMS);
  const collectsData = formsOf(files).length > 0;

  if (privacy && terms) {
    return result('legal_pages', 'PASS', 'A privacy page and a terms page were found.');
  }
  const missing = [!privacy && 'privacy policy', !terms && 'terms'].filter(Boolean).join(' and ');
  if (!privacy && collectsData) {
    return result(
      'legal_pages',
      'FAIL',
      `The site has forms that collect visitor data but no privacy policy page (missing: ${missing}).`,
      'Add a privacy policy page. You can generate an editable draft; it is not legal advice.',
    );
  }
  return result(
    'legal_pages',
    'WARN',
    `Missing ${missing} page.`,
    'Generate editable drafts and have a qualified professional review them.',
  );
}

export function checkMetaTags(files: SiteFile[], seo: SeoHints = {}): CheckResult {
  const index = files.find((f) => f.path === 'index.html');
  if (!index) {
    return result('meta_tags', 'NOT_VERIFIED', 'No index.html to inspect.');
  }
  const root = parseHtml(index.content);
  const meta = (selector: string) =>
    root.querySelector(selector)?.getAttribute('content')?.trim() || '';
  const found: Record<string, boolean> = {
    title: Boolean(root.querySelector('title')?.text.trim() || seo.title?.trim()),
    description: Boolean(meta('meta[name="description"]') || seo.description?.trim()),
    'og:title': Boolean(meta('meta[property="og:title"]') || seo.title?.trim()),
    'og:description': Boolean(
      meta('meta[property="og:description"]') || seo.description?.trim(),
    ),
    'og:image': Boolean(meta('meta[property="og:image"]') || seo.imageUrl?.trim()),
  };
  const missing = Object.keys(found).filter((k) => !found[k]);
  if (missing.length === 0) {
    return result(
      'meta_tags',
      'PASS',
      'Title, description and Open Graph tags are present on the home page (project SEO settings are injected at publish).',
    );
  }
  return result(
    'meta_tags',
    'WARN',
    `Home page is missing: ${missing.join(', ')}.`,
    'Fill in the SEO settings (title, description, social image).',
  );
}

export function checkViewport(files: SiteFile[]): CheckResult {
  const pages = htmlPages(files);
  if (pages.length === 0) return result('mobile_viewport', 'NOT_VERIFIED', 'No HTML pages found.');
  const missing = pages
    .filter((p) => !parseHtml(p.content).querySelector('meta[name="viewport"]'))
    .map((p) => p.path);
  return missing.length === 0
    ? result('mobile_viewport', 'PASS', `All ${pages.length} page(s) have a viewport meta tag. Layout itself was not tested on a device.`)
    : result(
        'mobile_viewport',
        'WARN',
        `No viewport meta tag on: ${list(missing)}.`,
        'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      );
}

function resolveInternal(fromFile: string, href: string) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return null;
  const parts = clean.startsWith('/') ? [] : fromFile.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;

export function checkBrokenLinks(files: SiteFile[]): CheckResult {
  const known = new Set(files.map((f) => f.path));
  const broken: string[] = [];
  let checked = 0;
  for (const file of htmlPages(files)) {
    for (const a of parseHtml(file.content).querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')?.trim();
      if (!href || EXTERNAL.test(href)) continue;
      const target = resolveInternal(file.path, href);
      if (target === null) continue;
      checked += 1;
      const candidates = [target, `${target}/index.html`, `${target}.html`];
      if (!candidates.some((c) => known.has(c)) && !(target === '' && known.has('index.html'))) {
        broken.push(`${file.path} → ${href}`);
      }
    }
  }
  return broken.length === 0
    ? result('broken_links', 'PASS', `${checked} internal link(s) resolve to files in the site.`)
    : result(
        'broken_links',
        'WARN',
        `Links that point to missing files: ${list(broken)}.`,
        'Fix or remove these links.',
      );
}

export function checkLiveLinks(live: LiveProbe | null): CheckResult {
  if (!live) {
    return result('live_links', 'NOT_VERIFIED', 'The site is not published at a public URL, so links were not crawled.');
  }
  if ('error' in live) {
    return result('live_links', 'NOT_VERIFIED', `Live site could not be fetched: ${live.error}`);
  }
  if (live.brokenLinks.length === 0) {
    return result('live_links', 'PASS', `${live.linksChecked} internal link(s) on the live home page answered without error.`);
  }
  return result(
    'live_links',
    'WARN',
    `Broken links on the live site: ${list(live.brokenLinks)}.`,
    'Fix these links and publish again.',
  );
}

const VALIDATION_ATTRS = ['required', 'pattern', 'min', 'max', 'minlength', 'maxlength'];
const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio']);

export function checkForms(files: SiteFile[]): CheckResult {
  const forms = formsOf(files);
  if (forms.length === 0) {
    return result('forms', 'PASS', 'No forms found in the site files, so there is nothing to validate.');
  }
  const unvalidated: string[] = [];
  for (const { file, form } of forms) {
    const fields = form
      .querySelectorAll('input, textarea, select')
      .filter((el) => !SKIP_INPUT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase()));
    const validated =
      fields.length > 0 &&
      fields.some(
        (el) =>
          VALIDATION_ATTRS.some((attr) => el.hasAttribute(attr)) ||
          ['email', 'url', 'tel', 'number'].includes((el.getAttribute('type') ?? '').toLowerCase()),
      );
    if (!validated) unvalidated.push(file);
  }
  const note = ' Only client-side attributes were inspected; server-side validation and delivery were not verified.';
  return unvalidated.length === 0
    ? result('forms', 'PASS', `${forms.length} form(s) have validation attributes.${note}`)
    : result(
        'forms',
        'WARN',
        `${unvalidated.length} of ${forms.length} form(s) have no validation attributes (${list([...new Set(unvalidated)])}).${note}`,
        'Add required, type="email", pattern or length attributes to form fields.',
      );
}

export function checkSecurityHeaders(live: LiveProbe | null): CheckResult {
  if (!live || 'error' in live) {
    return result('security_headers', 'NOT_VERIFIED', 'Headers can only be read from the live public URL, which was not available.');
  }
  const h = live.headers;
  const csp = h['content-security-policy'] ?? '';
  const missing = [
    !csp && 'Content-Security-Policy',
    !h['x-content-type-options'] && 'X-Content-Type-Options',
    !h['x-frame-options'] && !/frame-ancestors/i.test(csp) && 'X-Frame-Options (or CSP frame-ancestors)',
    !h['referrer-policy'] && 'Referrer-Policy',
    live.url.startsWith('https:') && !h['strict-transport-security'] && 'Strict-Transport-Security',
  ].filter(Boolean) as string[];
  return missing.length === 0
    ? result('security_headers', 'PASS', 'Key security headers were present on the live home page response.')
    : result(
        'security_headers',
        'WARN',
        `Missing on ${live.url}: ${missing.join(', ')}.`,
        'Configure these headers on your host or CDN.',
      );
}

export function checkHttps(live: LiveProbe | null): CheckResult {
  if (!live) return result('https', 'NOT_VERIFIED', 'The site is not published at a public URL.');
  let protocol = '';
  try {
    protocol = new URL(live.url).protocol;
  } catch {
    return result('https', 'NOT_VERIFIED', `Unrecognised URL "${live.url}".`);
  }
  return protocol === 'https:'
    ? result('https', 'PASS', `${live.url} is served over HTTPS.`)
    : result('https', 'FAIL', `${live.url} is not served over HTTPS.`, 'Serve the site over HTTPS before launching.');
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severe: boolean }> = [
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/, severe: true },
  { name: 'Stripe secret key', pattern: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/, severe: true },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, severe: true },
  { name: 'OpenAI-style API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/, severe: true },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/, severe: true },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, severe: true },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, severe: false },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, severe: true },
  {
    name: 'Hard-coded secret assignment',
    pattern: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'][A-Za-z0-9/+_-]{20,}["']/i,
    severe: false,
  },
];

const redact = (value: string) => `${value.slice(0, 4)}…(${value.length} chars)`;

export function checkSecrets(files: SiteFile[]): CheckResult {
  const scanned = files.filter((f) => isText(f.path) && f.content.length <= 2_000_000);
  const severe: string[] = [];
  const possible: string[] = [];
  for (const file of scanned) {
    for (const { name, pattern, severe: isSevere } of SECRET_PATTERNS) {
      const match = file.content.match(pattern);
      if (match) (isSevere ? severe : possible).push(`${name} in ${file.path} (${redact(match[0])})`);
    }
  }
  if (severe.length > 0) {
    return result(
      'secrets',
      'FAIL',
      `Secret-looking values found in served files: ${list(severe)}.`,
      'Remove the value from the files, rotate the credential, and keep secrets in environment variables on a server.',
    );
  }
  if (possible.length > 0) {
    return result(
      'secrets',
      'WARN',
      `Possible secrets (may be public identifiers): ${list(possible)}.`,
      'Confirm these values are safe to expose publicly.',
    );
  }
  return result(
    'secrets',
    'PASS',
    `No known secret patterns found in ${scanned.length} text file(s). This is a pattern scan, not a guarantee.`,
  );
}

export function checkContact(files: SiteFile[]): CheckResult {
  const found = new Set<string>();
  for (const file of htmlPages(files)) {
    const root = parseHtml(file.content);
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') ?? '';
      if (/^mailto:/i.test(href)) found.add('email link');
      if (/^tel:/i.test(href)) found.add('phone link');
      if (/contact|support|help/i.test(href) && !EXTERNAL.test(href)) found.add('contact page link');
    }
    if (/contact|support/i.test(file.path)) found.add('contact page');
    for (const form of root.querySelectorAll('form')) {
      const text = `${form.text} ${form
        .querySelectorAll('textarea, input')
        .map((i) => i.getAttribute('name') ?? '')
        .join(' ')}`;
      if (/email|message/i.test(text)) found.add('contact form');
    }
  }
  return found.size > 0
    ? result('contact', 'PASS', `Found: ${[...found].join(', ')}.`)
    : result('contact', 'WARN', 'No email/phone link, contact page or contact form found.', 'Give visitors a way to reach you.');
}

const ANALYTICS: Array<[string, RegExp]> = [
  ['Google Analytics/Tag Manager', /googletagmanager\.com|gtag\(|\bG-[A-Z0-9]{6,}\b/],
  ['Plausible', /plausible\.io/],
  ['Fathom', /usefathom\.com|cdn\.usefathom/],
  ['Umami', /umami/i],
  ['PostHog', /posthog/i],
  ['Mixpanel', /mixpanel/i],
  ['Segment', /segment\.com\/analytics\.js|analytics\.load\(/],
  ['Meta Pixel', /fbq\(|connect\.facebook\.net/],
  ['Cloudflare Web Analytics', /static\.cloudflareinsights\.com/],
];

export function detectAnalytics(files: SiteFile[]) {
  const found = new Set<string>();
  for (const file of files.filter((f) => isHtml(f.path) || /\.m?js$/i.test(f.path))) {
    for (const [name, pattern] of ANALYTICS) if (pattern.test(file.content)) found.add(name);
  }
  return [...found];
}

export function checkAnalytics(files: SiteFile[]): CheckResult {
  const found = detectAnalytics(files);
  return found.length > 0
    ? result('analytics', 'PASS', `Analytics snippet detected: ${found.join(', ')}. Whether events actually arrive was not verified.`)
    : result('analytics', 'WARN', 'No analytics snippet found in the site files.', 'Add an analytics provider if you want to measure visits and conversions.');
}

const PAYMENT_PROVIDERS: Array<[string, RegExp]> = [
  ['Stripe', /js\.stripe\.com|checkout\.stripe\.com|buy\.stripe\.com|\bStripe\(|stripe-pricing-table/i],
  ['PayPal', /paypal\.com\/sdk|paypalobjects\.com|paypal\.me/i],
  ['Paddle', /cdn\.paddle\.com|\bPaddle\./],
  ['Lemon Squeezy', /lemonsqueezy\.com|lemon\.js/i],
  ['Razorpay', /checkout\.razorpay\.com/i],
  ['Mollie', /js\.mollie\.com/i],
];

export function detectPaymentProviders(files: SiteFile[]) {
  const found = new Set<string>();
  for (const file of files.filter((f) => isText(f.path))) {
    for (const [name, pattern] of PAYMENT_PROVIDERS) if (pattern.test(file.content)) found.add(name);
  }
  return [...found];
}

export function checkPayments(files: SiteFile[]): CheckResult {
  const found = detectPaymentProviders(files);
  if (found.length === 0) {
    return result('payments', 'PASS', 'No payment provider integration detected in the site files.');
  }
  return result(
    'payments',
    'NOT_VERIFIED',
    `Payment integration detected: ${found.join(', ')}. The payment flow itself was not exercised here.`,
    "Run a full test purchase (checkout, success, failure, refund) in the provider's test mode before accepting real payments.",
  );
}

export function checkSmoke(smoke: SmokeSummary | null, liveVersion?: number | null): CheckResult {
  if (!smoke) {
    return result('smoke', 'NOT_VERIFIED', 'No smoke check has been recorded for the live site.', 'Run a smoke check from the Observatory after publishing.');
  }
  const when = `on ${smoke.checkedAt}`;
  if (smoke.outcome === 'CONFIRMED_FAILURE') {
    return result('smoke', 'FAIL', `The latest smoke check ${when} confirmed a failure.`, 'Open the smoke details and fix the failing request.');
  }
  if (smoke.outcome === 'SUSPECTED') {
    return result('smoke', 'WARN', `The latest smoke check ${when} suspected a problem.`);
  }
  if (liveVersion != null && smoke.version != null && smoke.version !== liveVersion) {
    return result('smoke', 'WARN', `The latest passing smoke check ${when} was for v${smoke.version}, but v${liveVersion} is live.`, 'Run a new smoke check.');
  }
  return result('smoke', 'PASS', `The latest smoke check passed ${when}.`);
}

/** Checks that only need the files; safe to run before publishing. */
export function runStaticChecks(files: SiteFile[], seo?: SeoHints): CheckResult[] {
  return [
    checkRequiredPages(files),
    checkLegalPages(files),
    checkMetaTags(files, seo),
    checkViewport(files),
    checkBrokenLinks(files),
    checkForms(files),
    checkSecrets(files),
    checkContact(files),
    checkAnalytics(files),
    checkPayments(files),
  ];
}

export function evaluateReadiness(input: ReadinessInput): CheckResult[] {
  const byId = new Map(runStaticChecks(input.files, input.seo).map((r) => [r.id, r]));
  const order: Array<CheckId | CheckResult> = [
    'required_pages',
    'legal_pages',
    'meta_tags',
    'mobile_viewport',
    'broken_links',
    checkLiveLinks(input.live),
    'forms',
    checkSecurityHeaders(input.live),
    checkHttps(input.live),
    'secrets',
    'contact',
    'analytics',
    'payments',
    checkSmoke(input.smoke, input.liveVersion),
  ];
  return order.map((entry) => (typeof entry === 'string' ? byId.get(entry)! : entry));
}

export type ReadinessSummary = {
  failCount: number;
  warnCount: number;
  notVerifiedCount: number;
  passCount: number;
  blocking: boolean;
  /** Deliberately never claims the site is production-ready. */
  verdict: string;
};

export function summarize(results: CheckResult[]): ReadinessSummary {
  const count = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  const failCount = count('FAIL');
  const warnCount = count('WARN');
  const notVerifiedCount = count('NOT_VERIFIED');
  const verdict =
    failCount > 0
      ? `${failCount} blocking issue(s) found. Fix them before launching.`
      : `No blocking issues found in verified checks. ${notVerifiedCount} check(s) could not be verified and ${warnCount} warning(s) remain; this is not a guarantee that the site is ready.`;
  return {
    failCount,
    warnCount,
    notVerifiedCount,
    passCount: count('PASS'),
    blocking: failCount > 0,
    verdict,
  };
}

export type ApprovalDecision = { ok: true } | { ok: false; error: string };

/** Approve launch is gated on no FAIL; warnings need an explicit acknowledgement. */
export function canApproveLaunch(
  results: CheckResult[],
  acknowledgedWarnings: boolean,
): ApprovalDecision {
  const { failCount, warnCount } = summarize(results);
  if (failCount > 0) {
    return { ok: false, error: `Fix the ${failCount} failing check(s) before approving.` };
  }
  if (warnCount > 0 && !acknowledgedWarnings) {
    return {
      ok: false,
      error: `Acknowledge the ${warnCount} warning(s) to approve the launch anyway.`,
    };
  }
  return { ok: true };
}

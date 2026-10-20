import { describe, expect, it } from 'vitest';

import {
  canApproveLaunch,
  checkBrokenLinks,
  checkForms,
  checkHttps,
  checkLegalPages,
  checkMetaTags,
  checkPayments,
  checkRequiredPages,
  checkSecrets,
  checkSecurityHeaders,
  checkSmoke,
  checkViewport,
  evaluateReadiness,
  summarize,
  type SiteFile,
} from './checks';

const GOOD_INDEX = `<!doctype html><html><head><title>Shop</title>
<meta name="description" content="A shop">
<meta property="og:title" content="Shop"><meta property="og:description" content="A shop">
<meta property="og:image" content="/og.png">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><a href="/privacy.html">Privacy</a><a href="terms.html">Terms</a>
<a href="mailto:hi@example.com">Mail</a>
<form><input type="email" name="email" required></form></body></html>`;

const page = (path: string, content = '<html><body>hello</body></html>'): SiteFile => ({ path, content });
const good: SiteFile[] = [page('index.html', GOOD_INDEX), page('privacy.html'), page('terms.html')];

describe('static checks', () => {
  it('requires a home page', () => {
    expect(checkRequiredPages(good).status).toBe('PASS');
    expect(checkRequiredPages([page('about.html')]).status).toBe('FAIL');
  });

  it('fails a missing privacy page only when forms collect data', () => {
    const withForm = [page('index.html', GOOD_INDEX.replace(/<a href="\/privacy.html">.*?<\/a>/, ''))];
    expect(checkLegalPages(withForm).status).toBe('FAIL');
    expect(checkLegalPages([page('index.html')]).status).toBe('WARN');
    expect(checkLegalPages(good).status).toBe('PASS');
  });

  it('uses SEO settings to satisfy meta tags', () => {
    const bare = [page('index.html', '<html><head></head><body>x</body></html>')];
    expect(checkMetaTags(bare).status).toBe('WARN');
    expect(
      checkMetaTags(bare, { title: 'T', description: 'D', imageUrl: 'https://x/y.png' }).status,
    ).toBe('PASS');
  });

  it('flags pages without a viewport tag', () => {
    const res = checkViewport([page('index.html', GOOD_INDEX), page('b.html')]);
    expect(res.status).toBe('WARN');
    expect(res.evidence).toContain('b.html');
  });

  it('finds broken internal links but ignores external ones', () => {
    const files = [
      page('index.html', '<a href="/missing.html">x</a><a href="https://example.org/a">y</a><a href="privacy.html">z</a>'),
      page('privacy.html'),
    ];
    const res = checkBrokenLinks(files);
    expect(res.status).toBe('WARN');
    expect(res.evidence).toContain('/missing.html');
    expect(res.evidence).not.toContain('example.org');
  });

  it('checks form validation attributes', () => {
    expect(checkForms([page('index.html', '<p>none</p>')]).status).toBe('PASS');
    expect(checkForms([page('index.html', '<form><input name="a"></form>')]).status).toBe('WARN');
    expect(checkForms(good).status).toBe('PASS');
  });

  it('fails on secrets with redacted evidence, never printing the value', () => {
    const secret = 'sk_live_' + 'a1B2c3D4e5F6g7H8i9J0';
    const res = checkSecrets([page('app.js', `const k = "${secret}";`)]);
    expect(res.status).toBe('FAIL');
    expect(res.evidence).not.toContain(secret);
    expect(checkSecrets([page('app.js', 'const pk = "pk_live_abcdefghijklmnop";')]).status).toBe('PASS');
  });

  it('never marks a detected payment integration as verified', () => {
    const res = checkPayments([page('index.html', '<script src="https://js.stripe.com/v3/"></script>')]);
    expect(res.status).toBe('NOT_VERIFIED');
    expect(res.advice).toMatch(/test mode/i);
  });
});

describe('live checks', () => {
  it('are NOT_VERIFIED without a live probe', () => {
    expect(checkHttps(null).status).toBe('NOT_VERIFIED');
    expect(checkSecurityHeaders(null).status).toBe('NOT_VERIFIED');
    expect(checkSmoke(null).status).toBe('NOT_VERIFIED');
  });

  it('fails plain http and warns on missing headers', () => {
    const base = { status: 200, headers: {}, brokenLinks: [], linksChecked: 0 };
    expect(checkHttps({ ...base, url: 'http://a.example.com/' }).status).toBe('FAIL');
    expect(checkSecurityHeaders({ ...base, url: 'https://a.example.com/' }).status).toBe('WARN');
    expect(
      checkSecurityHeaders({
        ...base,
        url: 'https://a.example.com/',
        headers: {
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'strict-transport-security': 'max-age=1',
        },
      }).status,
    ).toBe('PASS');
  });

  it('maps smoke outcomes', () => {
    const at = '2026-01-01';
    expect(checkSmoke({ outcome: 'CONFIRMED_FAILURE', checkedAt: at, version: 1 }).status).toBe('FAIL');
    expect(checkSmoke({ outcome: 'PASS', checkedAt: at, version: 1 }, 2).status).toBe('WARN');
    expect(checkSmoke({ outcome: 'PASS', checkedAt: at, version: 2 }, 2).status).toBe('PASS');
  });
});

describe('summary and approval', () => {
  it('never claims production readiness', () => {
    const results = evaluateReadiness({ files: good, live: null, smoke: null });
    const summary = summarize(results);
    expect(summary.failCount).toBe(0);
    expect(summary.verdict).toMatch(/no blocking issues found in verified checks/i);
    expect(summary.verdict).not.toMatch(/production[- ]ready/i);
    expect(results.every((r) => r.evidence.length > 0)).toBe(true);
  });

  it('blocks approval on FAIL and requires acknowledgement for warnings', () => {
    const failing = evaluateReadiness({ files: [page('about.html')], live: null, smoke: null });
    expect(canApproveLaunch(failing, true).ok).toBe(false);

    const warned = evaluateReadiness({ files: good, live: null, smoke: null });
    expect(summarize(warned).warnCount).toBeGreaterThan(0);
    expect(canApproveLaunch(warned, false).ok).toBe(false);
    expect(canApproveLaunch(warned, true).ok).toBe(true);
  });
});

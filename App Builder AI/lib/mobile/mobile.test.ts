import { describe, expect, it } from 'vitest';

import { buildCapacitorProjectFiles, generateCapacitorConfig, suggestAppId, validateAppId } from './capacitor';
import { parseStoreCredential } from './credentials';
import { evaluateChecklist, validateListing, type ListingInput } from './listing';
import {
  canTransition,
  decideNativeBuild,
  getRunnerConfig,
  parseRunnerCallback,
  submitToRunner,
} from './provider';
import { applyPwa, generateManifest, generateServiceWorker, injectPwaIntoHtml, toBytes, toText, type OutputFiles } from './pwa';
import { evaluatePwaReadiness } from './readiness';

const html = '<!doctype html><html><head><title>x</title></head><body><h1>Hi</h1></body></html>';
const base = (): OutputFiles => ({ 'index.html': toBytes(html) });

describe('pwa generators', () => {
  it('generates a manifest with clipped names and safe colours', () => {
    const manifest = JSON.parse(generateManifest({ name: 'A'.repeat(80), themeColor: 'red; x', backgroundColor: '#fff' }));
    expect(manifest.name).toHaveLength(45);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.theme_color).toBe('#111827');
    expect(manifest.background_color).toBe('#fff');
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('injects PWA tags idempotently', () => {
    const once = injectPwaIntoHtml(html, '#123456');
    expect(once).toContain('rel="manifest"');
    expect(once).toContain('serviceWorker.register');
    expect(injectPwaIntoHtml(once, '#123456')).toBe(once);
  });

  it('sanitises the cache version and always precaches the offline page', () => {
    const sw = generateServiceWorker({ cacheVersion: "v1';alert(1)", precache: ['index.html'] });
    expect(sw).toContain("'app-shell-v1alert1'");
    expect(sw).not.toContain("';alert");
    expect(sw).toContain('"offline.html"');
  });

  it('never overwrites files the project already has', () => {
    const custom = toBytes('{"name":"mine"}');
    const result = applyPwa({ ...base(), 'manifest.webmanifest': custom }, { name: 'App' });
    expect(result.files['manifest.webmanifest']).toBe(custom);
    expect(result.kept).toContain('manifest.webmanifest');
    expect(result.added).toContain('sw.js');
  });
});

describe('pwa readiness', () => {
  it('scores a bare page low and not installable', () => {
    const r = evaluatePwaReadiness({ files: base(), publicUrl: null });
    expect(r.installable).toBe(false);
    expect(r.score).toBeLessThan(30);
  });

  it('is honest about missing PNG icons even after generation', () => {
    const { files } = applyPwa(base(), { name: 'App' });
    const r = evaluatePwaReadiness({ files, publicUrl: 'https://app.example.com' });
    expect(r.checks.find((c) => c.id === 'icon-files')?.status).toBe('fail');
    expect(r.installable).toBe(false);
  });

  it('is installable with HTTPS and real icon files', () => {
    const { files } = applyPwa(base(), { name: 'App' });
    files['icons/icon-192.png'] = new Uint8Array([1]);
    files['icons/icon-512.png'] = new Uint8Array([1]);
    files['icons/icon-maskable-512.png'] = new Uint8Array([1]);
    const r = evaluatePwaReadiness({ files, publicUrl: 'https://app.example.com' });
    expect(r.installable).toBe(true);
    expect(r.checks.find((c) => c.id === 'https')?.status).toBe('pass');
  });

  it('fails HTTPS for plain http', () => {
    const r = evaluatePwaReadiness({ files: base(), publicUrl: 'http://app.example.com' });
    expect(r.checks.find((c) => c.id === 'https')?.status).toBe('fail');
  });
});

describe('capacitor bundle', () => {
  it('validates app ids', () => {
    expect(validateAppId('com.example.app')).toBeNull();
    expect(validateAppId('Com.Example')).not.toBeNull();
    expect(validateAppId('app')).not.toBeNull();
    expect(validateAppId('com.1bad.app')).not.toBeNull();
    expect(suggestAppId('123 My-App!')).toBe('com.appweaver.myapp');
  });

  it('lays out www, config, package and instructions', () => {
    const opts = { appId: 'com.example.app', appName: 'My "App"', versionName: '1.2.0', buildNumber: 7 };
    const files = buildCapacitorProjectFiles(base(), opts);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['www/index.html', 'capacitor.config.ts', 'package.json', 'README-MOBILE.md']));
    expect(generateCapacitorConfig(opts)).toContain('"My \\"App\\""');
    expect(JSON.parse(toText(files['package.json'])).dependencies['@capacitor/core']).toBeDefined();
    expect(toText(files['README-MOBILE.md'])).toContain('NOT a compiled app');
  });
});

describe('store listing validation', () => {
  const ok: ListingInput = {
    appName: 'My App',
    bundleId: 'com.example.app',
    shortDescription: 'Does things',
    description: 'A'.repeat(60),
    category: 'Productivity',
    keywords: '',
    privacyUrl: 'https://example.com/privacy',
    supportUrl: '',
    ageRating: 'EVERYONE',
    screenshotRefs: ['https://example.com/a.png', 'shots/b.png'],
  };

  it('accepts a complete Google Play listing', () => {
    expect(validateListing('GOOGLE_PLAY', ok)).toEqual([]);
  });

  it('applies per-store rules', () => {
    const apple = validateListing('APP_STORE_CONNECT', ok).map((i) => i.field);
    expect(apple).toContain('ageRating');
    expect(apple).not.toContain('screenshotRefs');
    const gp = validateListing('GOOGLE_PLAY', { ...ok, screenshotRefs: ['https://example.com/a.png'] }).map((i) => i.field);
    expect(gp).toContain('screenshotRefs');
  });

  it('rejects insecure privacy URLs and traversal screenshot refs', () => {
    const fields = validateListing('GOOGLE_PLAY', { ...ok, privacyUrl: 'http://x.com', screenshotRefs: ['../secret.png', '/etc/passwd'] }).map((i) => i.field);
    expect(fields).toContain('privacyUrl');
    expect(fields).toContain('screenshotRefs');
  });

  it('derives automatic checklist items and manual confirmations', () => {
    const items = evaluateChecklist(
      'GOOGLE_PLAY',
      { listingValid: true, privacyUrlValid: true, credentialsSaved: false, bundleBuilt: true },
      new Set(['signing']),
    );
    const done = Object.fromEntries(items.map((i) => [i.key, i.done]));
    expect(done['listing-valid']).toBe(true);
    expect(done.credentials).toBe(false);
    expect(done.signing).toBe(true);
    expect(done['data-safety']).toBe(false);
  });
});

describe('store credentials', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

  it('accepts a service account and exposes only the email as hint', () => {
    const r = parseStoreCredential({
      store: 'GOOGLE_PLAY',
      serviceAccountJson: JSON.stringify({ type: 'service_account', client_email: 'bot@proj.iam.example.com', private_key: pem }),
    });
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.hint).toBe('bot@proj.iam.example.com');
  });

  it('rejects malformed input without echoing it', () => {
    expect(parseStoreCredential({ store: 'GOOGLE_PLAY', serviceAccountJson: 'nope' })).toHaveProperty('error');
    expect(parseStoreCredential({ store: 'APP_STORE_CONNECT', keyId: 'short', issuerId: 'x', privateKey: pem })).toHaveProperty('error');
    const apple = parseStoreCredential({
      store: 'APP_STORE_CONNECT',
      keyId: 'ABCDE12345',
      issuerId: '12345678-1234-1234-1234-123456789012',
      privateKey: pem,
    });
    expect(apple).toMatchObject({ hint: 'Key ABCDE12345' });
  });
});

describe('native build provider status', () => {
  const runner = { url: 'https://r.example.com', token: 't', platforms: new Set(['ANDROID' as const]) };
  const base = { platform: 'ANDROID' as const, runner, hasStoreCredential: true, planAllowsNative: true };

  it('reads the runner from env only when complete and secure', () => {
    expect(getRunnerConfig({})).toBeNull();
    expect(getRunnerConfig({ MOBILE_BUILD_RUNNER_URL: 'http://evil.example.com', MOBILE_BUILD_RUNNER_TOKEN: 't' })).toBeNull();
    const cfg = getRunnerConfig({ MOBILE_BUILD_RUNNER_URL: 'https://r.example.com', MOBILE_BUILD_RUNNER_TOKEN: 't', MOBILE_BUILD_RUNNER_PLATFORMS: 'android, ios' });
    expect([...(cfg?.platforms ?? [])].sort()).toEqual(['ANDROID', 'IOS']);
  });

  it('blocks instead of faking success when setup is missing', () => {
    expect(decideNativeBuild({ ...base, runner: null })).toMatchObject({ action: 'blocked' });
    expect(decideNativeBuild({ ...base, platform: 'IOS' })).toMatchObject({ action: 'blocked', reason: expect.stringContaining('macOS') });
    expect(decideNativeBuild({ ...base, hasStoreCredential: false })).toMatchObject({ action: 'blocked', reason: expect.stringContaining('credentials') });
    expect(decideNativeBuild({ ...base, planAllowsNative: false })).toMatchObject({ action: 'blocked' });
    expect(decideNativeBuild(base)).toEqual({ action: 'submit' });
  });

  it('keeps terminal states final', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('SUCCEEDED', 'FAILED')).toBe(false);
    expect(canTransition('BLOCKED', 'SUCCEEDED')).toBe(false);
  });

  it('requires an artifact and checksum for a runner success', () => {
    expect(parseRunnerCallback({ buildId: 'b', status: 'SUCCEEDED' })).toHaveProperty('error');
    expect(parseRunnerCallback({ buildId: 'b', status: 'BLOCKED' })).toHaveProperty('error');
    expect(parseRunnerCallback({ buildId: 'b', status: 'SUCCEEDED', artifactName: 'app.aab', artifactSha256: 'a'.repeat(64) })).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('reports runner failures honestly', async () => {
    const job = { buildId: 'b', platform: 'ANDROID' as const, appId: 'com.example.app', versionName: '1.0.0', buildNumber: 1, bundleBase64: '', callbackUrl: 'https://x/cb' };
    const rejected = await submitToRunner(runner, job, (async () => new Response('no', { status: 500 })) as typeof fetch);
    expect(rejected).toEqual({ ok: false, error: 'Runner rejected the job (HTTP 500).' });
    const accepted = await submitToRunner(runner, job, (async () => Response.json({ jobId: 'j1' })) as typeof fetch);
    expect(accepted).toEqual({ ok: true, jobId: 'j1' });
  });
});

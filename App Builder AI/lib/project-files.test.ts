import { describe, expect, it } from 'vitest';

import {
  buildDbPath,
  getMimeType,
  injectPreviewBaseHref,
  normalizeRelativePath,
  stripPreviewBaseHref,
} from '@/lib/project-files';

describe('normalizeRelativePath', () => {
  it('leaves a simple relative path untouched', () => {
    expect(normalizeRelativePath('src/index.html')).toBe('src/index.html');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeRelativePath('src\\components\\App.tsx')).toBe(
      'src/components/App.tsx',
    );
  });

  it('strips ".." segments to prevent path traversal', () => {
    expect(normalizeRelativePath('../../etc/passwd')).toBe('etc/passwd');
  });

  it('strips "." segments', () => {
    expect(normalizeRelativePath('./src/./index.html')).toBe('src/index.html');
  });

  it('strips embedded ".." traversal segments', () => {
    expect(normalizeRelativePath('src/../../../secrets.env')).toBe(
      'src/secrets.env',
    );
  });

  it('trims whitespace within segments', () => {
    expect(normalizeRelativePath(' src / index.html ')).toBe('src/index.html');
  });

  it('drops empty segments from duplicate slashes', () => {
    expect(normalizeRelativePath('src//index.html')).toBe('src/index.html');
  });

  it('returns an empty string for a path that is only traversal segments', () => {
    expect(normalizeRelativePath('../../..')).toBe('');
  });
});

describe('buildDbPath', () => {
  it('joins the artifact slug and normalized relative path', () => {
    expect(buildDbPath('my-artifact', 'src/index.html')).toBe(
      'my-artifact/src/index.html',
    );
  });

  it('throws for a path that normalizes to empty (pure traversal)', () => {
    expect(() => buildDbPath('my-artifact', '../..')).toThrow('Invalid file path.');
  });
});

describe('getMimeType', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['styles.css', 'text/css; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['data.json', 'application/json; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
  ])('maps %s to %s', (file, expected) => {
    expect(getMimeType(file)).toBe(expected);
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(getMimeType('archive.unknownext')).toBe('application/octet-stream');
  });

  it('is case-insensitive on extension', () => {
    expect(getMimeType('IMAGE.PNG')).toBe('image/png');
  });
});

describe('injectPreviewBaseHref / stripPreviewBaseHref', () => {
  it('inserts a base tag right after <head>', () => {
    const html = '<html><head><title>Test</title></head><body></body></html>';
    const result = injectPreviewBaseHref(html, 'project-1', 'artifact-1');
    expect(result).toContain(
      '<base href="/api/projects/project-1/preview/artifact-1/" />',
    );
    expect(result.indexOf('<base')).toBeLessThan(result.indexOf('<title>'));
  });

  it('replaces an existing base tag', () => {
    const html = '<head><base href="/old/" /></head>';
    const result = injectPreviewBaseHref(html, 'project-1', 'artifact-1');
    expect(result).toContain(
      '<base href="/api/projects/project-1/preview/artifact-1/" />',
    );
    expect(result).not.toContain('/old/');
  });

  it('prepends the base tag when there is no <head>', () => {
    const html = '<div>no head here</div>';
    const result = injectPreviewBaseHref(html, 'project-1', 'artifact-1');
    expect(result.startsWith('<base')).toBe(true);
  });

  it('round-trips: stripping removes what injecting added', () => {
    const html = '<head><title>Test</title></head>';
    const injected = injectPreviewBaseHref(html, 'p', 'a');
    const stripped = stripPreviewBaseHref(injected);
    expect(stripped).not.toContain('<base');
  });
});

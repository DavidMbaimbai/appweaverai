import { describe, expect, it } from 'vitest';

import { injectSeoTags } from './seo-shim';

describe('injectSeoTags', () => {
  it('adds title, description and og tags to <head>', () => {
    const out = injectSeoTags('<html><head></head><body></body></html>', {
      title: 'My "Site"',
      description: 'About us',
      imageUrl: 'https://x.test/a.png',
    });
    expect(out).toContain('<title>My &quot;Site&quot;</title>');
    expect(out).toContain('name="description" content="About us"');
    expect(out).toContain('og:image');
  });

  it('does not override tags the page already has', () => {
    const html =
      '<html><head><title>Own</title><meta name="description" content="own"></head></html>';
    const out = injectSeoTags(html, { title: 'New', description: 'New' });
    expect(out).not.toContain('<title>New</title>');
    expect(out.match(/name="description"/g)).toHaveLength(1);
  });

  it('ignores non-http social images and empty values', () => {
    const html = '<html><head></head></html>';
    expect(injectSeoTags(html, {})).toBe(html);
    expect(injectSeoTags(html, { imageUrl: 'javascript:alert(1)' })).toBe(html);
  });
});

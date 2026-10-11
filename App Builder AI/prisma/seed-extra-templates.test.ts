import { describe, expect, it } from 'vitest';
import { buildSite, EXTRA_SECTIONS, EXTRA_SITES } from './seed-extra-templates';

describe('extra seed templates', () => {
  const sites = EXTRA_SITES.map((c) => buildSite(c, '', ''));

  it('has unique slugs and sort orders', () => {
    const all = [...sites, ...EXTRA_SECTIONS];
    expect(new Set(all.map((t) => t.slug)).size).toBe(all.length);
    expect(new Set(sites.map((t) => t.sortOrder)).size).toBe(sites.length);
  });

  it('builds publishable pages with a form', () => {
    for (const site of sites) {
      const html = site.files.map((f) => f.content).join('\n');
      expect(html).toContain('<title>');
      expect(html).toContain('<h1');
      expect(html).toContain('data-aw-form');
    }
  });
});

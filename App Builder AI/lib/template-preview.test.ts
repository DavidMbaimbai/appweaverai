import { describe, expect, it } from 'vitest';
import { buildTemplatePreviewHtml } from './template-preview';

describe('buildTemplatePreviewHtml', () => {
  it('inlines the stylesheet and script of a full template', () => {
    const html = buildTemplatePreviewHtml(
      [
        {
          path: 'index.html',
          content:
            '<html><head><link rel="stylesheet" href="styles.css" /></head><body><script src="script.js"></script></body></html>',
        },
        { path: 'styles.css', content: 'body{color:red}' },
        { path: 'script.js', content: 'console.log(1)' },
      ],
      'FULL_TEMPLATE',
    );
    expect(html).toContain('<style>body{color:red}</style>');
    expect(html).toContain('<script>console.log(1)</script>');
    expect(html).not.toContain('href="styles.css"');
  });

  it('wraps a section in a page', () => {
    const html = buildTemplatePreviewHtml(
      [{ path: 'section.html', content: '<section>Hi</section>' }],
      'SECTION',
    );
    expect(html).toContain('<section>Hi</section>');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('returns null when the main file is missing', () => {
    expect(buildTemplatePreviewHtml([], 'FULL_TEMPLATE')).toBeNull();
    expect(buildTemplatePreviewHtml([], 'SECTION')).toBeNull();
  });
});

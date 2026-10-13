import { describe, expect, it } from 'vitest';

import { checkHtmlPage } from './preflight';

const files = new Set(['index.html', 'styles.css', 'about.html', 'logo.png']);
const seo = { description: 'A short description of the shop.' };

describe('checkHtmlPage', () => {
  it('passes a healthy page', () => {
    const html =
      '<html><head><title>Hi</title></head><body><h1>Welcome to my shop</h1><p>Plenty of real content here.</p><a href="about.html">About</a><a href="https://x.com">X</a><a href="#top">Top</a><div id="top"></div>      <img src="logo.png" alt="Logo"></body></html>';
    expect(checkHtmlPage('index.html', html, files, seo)).toEqual([]);
  });

  it('reports common SEO issues', () => {
    const html = `<html><head><title>${'T'.repeat(70)}</title></head><body><h1>One heading</h1><h1>Two headings</h1><p>Plenty of real content here.</p></body></html>`;
    const messages = checkHtmlPage('index.html', html, files).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('over 60 characters'),
        expect.stringContaining('no meta description'),
        expect.stringContaining('2 main headings'),
      ]),
    );
  });

  it('accepts project-level SEO title and description for the main page', () => {
    const html =
      '<html><body><h1>Welcome to my shop</h1><p>Plenty of real content here.</p></body></html>';
    expect(
      checkHtmlPage('index.html', html, files, { title: 'Shop', description: 'About the shop.' }),
    ).toEqual([]);
  });

        it('warns about images without alt text', () => {
          const html =
            '<html><head><title>Hi</title></head><body><h1>Welcome to my shop</h1><p>Plenty of real content here.</p><img src="logo.png"></body></html>';
          const issues = checkHtmlPage('index.html', html, files, seo);
          expect(issues).toEqual([
            expect.objectContaining({ severity: 'warning', message: expect.stringContaining('alt text') }),
          ]);
        });

  it('flags empty pages, broken links and missing images', () => {
    const html =
      '<html><body><a href="nope.html">Gone</a><a href="#missing">Jump</a><a href="#">Soon</a><img src="x.png"><img></body></html>';
    const issues = checkHtmlPage('index.html', html, files);
    const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);

    expect(errors).toEqual(
      expect.arrayContaining([
        'The page has almost no visible content.',
        '"Gone" links to a page that does not exist: nope.html',
        '"Jump" points to missing section #missing.',
        'Image file not found: x.png',
        'An image has no source.',
      ]),
    );
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('"Soon"'))).toBe(true);
  });

  it('treats links to the site root as valid', () => {
    const html =
      '<html><head><title>Hi</title></head><body><h1>Welcome to my shop</h1><p>Plenty of real content here.</p><a href="/">Home</a><a href="./">Home</a></body></html>';
    const messages = checkHtmlPage('index.html', html, files, seo).map((i) => i.message);
    expect(messages.filter((m) => m.includes('does not exist'))).toEqual([]);
  });
});


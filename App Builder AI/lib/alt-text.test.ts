import { describe, expect, it } from 'vitest';

import { applyImageAlts, listPageImages } from './alt-text';

const html =
  '<body><img src="a.png"><p>x > y</p><img src="b.png" alt="Old &amp; busted"><img src=\'c.png\' alt=""/></body>';

describe('listPageImages', () => {
  it('lists sources and alt text in document order', () => {
    expect(listPageImages(html)).toEqual([
      { index: 0, src: 'a.png', alt: null },
      { index: 1, src: 'b.png', alt: 'Old & busted' },
      { index: 2, src: 'c.png', alt: '' },
    ]);
  });
});

describe('applyImageAlts', () => {
  it('adds, replaces and escapes alt text without touching other markup', () => {
    const next = applyImageAlts(html, { 0: 'A "logo"', 1: 'New photo' });
    expect(next).toContain('<img alt="A &quot;logo&quot;" src="a.png">');
    expect(next).toContain('<img src="b.png" alt="New photo">');
    expect(next).toContain('<p>x > y</p>');
    expect(next).toContain("<img src='c.png' alt=\"\"/>");
  });

  it('can mark an image decorative', () => {
    expect(applyImageAlts('<img src="a.png">', { 0: '' })).toBe(
      '<img alt="" src="a.png">',
    );
  });
});

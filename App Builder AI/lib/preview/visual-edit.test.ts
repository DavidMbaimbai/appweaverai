import { describe, expect, it } from 'vitest';

import {
  annotateHtmlForVisualEdit,
  applyVisualEditPatch,
  extractElementHtml,
} from '@/lib/preview/visual-edit';

const SAMPLE_HTML =
  '<!DOCTYPE html>\n<html><head><title>t</title></head><body>' +
  '<section><h1>Hello</h1><p>World</p>' +
  '<img src="/old.png" alt="old" />' +
  '<a href="/old-link">Link</a>' +
  '<script>var x = 1;</script>' +
  '</section></body></html>';

describe('annotateHtmlForVisualEdit', () => {
  it('assigns a data-aw-id to every editable element in document order', () => {
    const annotated = annotateHtmlForVisualEdit(SAMPLE_HTML);
    const ids = [...annotated.matchAll(/data-aw-id="(\d+)"/g)].map(
      (match) => match[1],
    );
    expect(ids).toEqual(['0', '1', '2', '3', '4']);
  });

  it('does not annotate <script> or <style> elements', () => {
    const annotated = annotateHtmlForVisualEdit(SAMPLE_HTML);
    expect(annotated).toContain('<script>var x = 1;</script>');
  });

  it('returns the input unchanged when there is no <body>', () => {
    const noBody = '<html><head><title>t</title></head></html>';
    expect(annotateHtmlForVisualEdit(noBody)).toBe(noBody);
  });
});

describe('applyVisualEditPatch', () => {
  it('updates text content for the targeted element and strips ids', () => {
    const result = applyVisualEditPatch(SAMPLE_HTML, '1', {
      kind: 'text',
      text: 'Updated heading',
    });

    expect(result).toContain('<h1>Updated heading</h1>');
    expect(result).not.toContain('data-aw-id');
  });

  it('escapes HTML special characters in text edits', () => {
    const result = applyVisualEditPatch(SAMPLE_HTML, '1', {
      kind: 'text',
      text: '<script>alert(1)</script> & co',
    });

    expect(result).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; co',
    );
  });

  it('updates attributes for the targeted element', () => {
    const result = applyVisualEditPatch(SAMPLE_HTML, '3', {
      kind: 'attrs',
      attrs: { src: '/new.png', alt: null },
    });

    expect(result).toContain('src="/new.png"');
    expect(result).not.toContain('alt=');
  });

  it('removes the targeted element for a delete patch', () => {
    const result = applyVisualEditPatch(SAMPLE_HTML, '4', { kind: 'delete' });

    expect(result).not.toContain('<a href="/old-link">Link</a>');
  });

  it('merges style changes into the inline style and keeps other rules', () => {
    const html =
      '<html><body><h1 style="color: red; margin: 0">Hi</h1></body></html>';
    const result = applyVisualEditPatch(html, '0', {
      kind: 'style',
      style: { color: '#0d9488', 'font-size': '32px', margin: null },
    });

    expect(result).toContain('color: #0d9488');
    expect(result).toContain('font-size: 32px');
    expect(result).not.toContain('margin');
  });

  it('rejects unsafe or unsupported style values', () => {
    const html = '<html><body><h1>Hi</h1></body></html>';
    expect(() =>
      applyVisualEditPatch(html, '0', {
        kind: 'style',
        style: { color: 'red; background: url(x)' },
      }),
    ).toThrow();
    expect(() =>
      applyVisualEditPatch(html, '0', {
        kind: 'style',
        style: { position: 'fixed' },
      }),
    ).toThrow(/cannot be edited/);
  });

  it('extracts one element as clean html', () => {
    const html = extractElementHtml(SAMPLE_HTML, '1');
    expect(html).toBe('<h1>Hello</h1>');
    expect(extractElementHtml(SAMPLE_HTML, '999')).toBeNull();
  });

  it('throws when the element id no longer exists', () => {
    expect(() =>
      applyVisualEditPatch(SAMPLE_HTML, '999', {
        kind: 'text',
        text: 'nope',
      }),
    ).toThrow(/Could not find the selected element/);
  });
});

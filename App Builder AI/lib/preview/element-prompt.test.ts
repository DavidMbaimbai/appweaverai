import { describe, expect, it } from 'vitest';

import { buildElementEditPrompt } from './element-prompt';

describe('buildElementEditPrompt', () => {
  it('scopes the edit to the selected element', () => {
    const prompt = buildElementEditPrompt({
      instruction: ' make it bolder ',
      tag: 'section',
      html: '<section class="hero">Hi</section>',
    });
    expect(prompt).toContain('<section> element on my page: make it bolder');
    expect(prompt).toContain('<section class="hero">Hi</section>');
    expect(prompt).toMatch(/Leave every other part/);
  });

  it('truncates very large snippets', () => {
    const prompt = buildElementEditPrompt({
      instruction: 'x',
      tag: 'div',
      html: 'a'.repeat(5000),
    });
    expect(prompt.length).toBeLessThan(2000);
  });
});

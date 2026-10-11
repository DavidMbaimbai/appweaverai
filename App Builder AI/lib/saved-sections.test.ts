import { describe, expect, it } from 'vitest';

import { extractPageSections } from './saved-sections';

describe('extractPageSections', () => {
  it('returns top-level body elements and skips scripts/styles', () => {
    const sections = extractPageSections(
      '<html><body><header><h1>Hi there</h1></header><style>a{}</style><section id="pricing"><p>x</p></section><script>1</script></body></html>',
    );

    expect(sections.map((s) => s.label)).toEqual([
      'Hi there (header)',
      '#pricing (section)',
    ]);
    expect(sections[1].html).toBe('<section id="pricing"><p>x</p></section>');
  });
});

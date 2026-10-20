import { describe, expect, it } from 'vitest';

import { LEGAL_NOTICE, renderLegalPage, sanitizeDraftHtml } from './legal-drafts';

describe('legal drafts', () => {
  it('strips scripts, event attributes and non-mailto links from AI output', () => {
    const html = sanitizeDraftHtml(
      '<h2 onclick="x()">Data</h2><script>alert(1)</script><p>Hi <a href="javascript:alert(1)">there</a> <a href="mailto:a@b.co">mail</a></p><iframe src="x"></iframe>',
    );
    expect(html).toBe('<h2>Data</h2><p>Hi there <a href="mailto:a@b.co">mail</a></p>');
  });

  it('always carries the not-legal-advice notice and escapes the site name', () => {
    const page = renderLegalPage('privacy', 'A <b>&</b> Co', '<p>x</p>');
    expect(page).toContain(LEGAL_NOTICE);
    expect(LEGAL_NOTICE).toMatch(/not legal advice/i);
    expect(page).not.toContain('<b>');
    expect(page).toContain('<meta name="viewport"');
  });
});

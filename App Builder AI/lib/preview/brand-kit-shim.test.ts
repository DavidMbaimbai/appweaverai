import { describe, expect, it } from 'vitest';

import {
  buildBrandKitShim,
  hasBrandKitValues,
  injectBrandKitShim,
} from './brand-kit-shim';

const EMPTY = {
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
};

describe('hasBrandKitValues', () => {
  it('returns false when every field is null', () => {
    expect(hasBrandKitValues(EMPTY)).toBe(false);
  });

  it('returns true when at least one field is set', () => {
    expect(hasBrandKitValues({ ...EMPTY, primaryColor: '#ff0000' })).toBe(
      true,
    );
  });
});

describe('injectBrandKitShim', () => {
  it('leaves the HTML untouched when no brand kit values are set', () => {
    const html = '<html><head></head><body></body></html>';
    expect(injectBrandKitShim(html, EMPTY)).toBe(html);
  });

  it('injects a style block defining CSS custom properties into <head>', () => {
    const html = '<html><head><title>Hi</title></head><body></body></html>';
    const result = injectBrandKitShim(html, {
      ...EMPTY,
      primaryColor: '#4f46e5',
      fontFamily: "'Inter', sans-serif",
    });

    expect(result).toContain('id="aw-brand-kit-style"');
    expect(result).toContain('--aw-brand-primary: #4f46e5;');
    expect(result).toContain("--aw-brand-font: 'Inter', sans-serif;");
    // Injected before the existing head content.
    expect(result.indexOf('aw-brand-kit-style')).toBeLessThan(
      result.indexOf('<title>Hi</title>'),
    );
  });

  it('includes a logo-swap script only when a logo URL is set', () => {
    const html = '<html><head></head><body></body></html>';

    const withoutLogo = injectBrandKitShim(html, {
      ...EMPTY,
      primaryColor: '#000',
    });
    expect(withoutLogo).not.toContain('data-aw-logo');

    const withLogo = injectBrandKitShim(html, {
      ...EMPTY,
      logoUrl: 'https://example.com/logo.png',
    });
    expect(withLogo).toContain('data-aw-logo');
    expect(withLogo).toContain('https://example.com/logo.png');
  });

  it('escapes single quotes in the logo URL to avoid breaking the script', () => {
    const shim = buildBrandKitShim({
      ...EMPTY,
      logoUrl: "https://example.com/it's-a-logo.png",
    });
    expect(shim).toContain("it\\'s-a-logo.png");
  });
});

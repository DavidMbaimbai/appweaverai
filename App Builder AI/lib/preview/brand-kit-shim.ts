import type { BrandKitValues } from '@/lib/brand-kit/project-brand-kit';

/**
 * Injects brand-kit CSS custom properties (and a modest set of generic
 * selector overrides) plus a tiny inline script that swaps any
 * `[data-aw-logo]` image's `src` for the saved logo URL. Values are only
 * defined as CSS variables — templates/sections authored by the agent are
 * expected to reference `var(--aw-brand-primary, ...)` etc, and the generic
 * overrides below give arbitrary HTML a reasonable best-effort result even
 * when it doesn't.
 */
function escapeForJsString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function hasBrandKitValues(brandKit: BrandKitValues) {
  return Boolean(
    brandKit.logoUrl ||
      brandKit.primaryColor ||
      brandKit.secondaryColor ||
      brandKit.accentColor ||
      brandKit.fontFamily,
  );
}

const NON_WEB_FONTS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'arial',
  'helvetica',
  'helvetica neue',
  'georgia',
  'times new roman',
  'times',
  'courier new',
  'verdana',
  'tahoma',
  'trebuchet ms',
]);

/**
 * Returns a Google Fonts stylesheet link for the primary font. Any plain font
 * name that isn't a generic/system family is requested from Google Fonts; an
 * unknown name just fails to load and the fallback stack applies.
 */
export function buildFontLink(fontFamily: string | null) {
  if (!fontFamily) return '';
  const primary = fontFamily
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/.test(primary)) return '';
  if (NON_WEB_FONTS.has(primary.toLowerCase())) return '';
  const family = primary.replace(/ +/g, '+');
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=${family}:400,500,600,700&display=swap">`;
}

export function buildBrandKitShim(brandKit: BrandKitValues) {
  const vars: string[] = [];
  if (brandKit.primaryColor) {
    vars.push(`--aw-brand-primary: ${brandKit.primaryColor};`);
  }
  if (brandKit.secondaryColor) {
    vars.push(`--aw-brand-secondary: ${brandKit.secondaryColor};`);
  }
  if (brandKit.accentColor) {
    vars.push(`--aw-brand-accent: ${brandKit.accentColor};`);
  }
  if (brandKit.fontFamily) {
    vars.push(`--aw-brand-font: ${brandKit.fontFamily};`);
  }

  const overrides = brandKit.fontFamily
    ? 'body { font-family: var(--aw-brand-font, inherit); }'
    : '';

  const colorOverrides = `
    a { color: var(--aw-brand-primary, inherit); }
    button, [type="submit"], [class*="btn-primary"], [class*="button-primary"] {
      background-color: var(--aw-brand-primary, inherit);
      border-color: var(--aw-brand-primary, inherit);
    }
    [class*="btn-secondary"], [class*="button-secondary"] {
      background-color: var(--aw-brand-secondary, inherit);
      border-color: var(--aw-brand-secondary, inherit);
    }
    [class*="accent"] { color: var(--aw-brand-accent, inherit); }
  `;

  const logoScript = brandKit.logoUrl
    ? `<script>
(function () {
  var url = '${escapeForJsString(brandKit.logoUrl)}';
  function applyLogo() {
    document.querySelectorAll('[data-aw-logo]').forEach(function (el) {
      if (el.tagName === 'IMG') {
        el.setAttribute('src', url);
      } else {
        el.style.backgroundImage = "url('" + url + "')";
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLogo);
  } else {
    applyLogo();
  }
})();
</script>`
    : '';

  return `${buildFontLink(brandKit.fontFamily)}<style id="aw-brand-kit-style">:root{${vars.join(' ')}}${overrides}${colorOverrides}</style>${logoScript}`;
}

/** Injects the brand-kit style/script block as the first child of `<head>`. */
export function injectBrandKitShim(html: string, brandKit: BrandKitValues) {
  if (!hasBrandKitValues(brandKit)) return html;

  const shim = buildBrandKitShim(brandKit);

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${shim}`);
  }

  return `${shim}\n${html}`;
}

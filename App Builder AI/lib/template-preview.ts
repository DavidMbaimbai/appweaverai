type PreviewFile = { path: string; content: string };

const SECTION_SHELL = (body: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fff;color:#17171f}</style>
</head><body>
${body}
</body></html>`;

/**
 * Builds a single self-contained HTML document for previewing a template in
 * a sandboxed iframe: stylesheets/scripts referenced by index.html are
 * inlined, and a bare section is wrapped in a minimal page.
 */
export function buildTemplatePreviewHtml(
  files: PreviewFile[],
  kind: 'FULL_TEMPLATE' | 'SECTION',
): string | null {
  const byPath = new Map(files.map((file) => [file.path, file.content]));

  if (kind === 'SECTION') {
    const section = byPath.get('section.html');
    return section ? SECTION_SHELL(section) : null;
  }

  const index = byPath.get('index.html');
  if (!index) return null;

  return index
    .replace(
      /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
      (match, href: string) => {
        const css = byPath.get(href);
        return css === undefined ? match : `<style>${css}</style>`;
      },
    )
    .replace(
      /<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
      (match, src: string) => {
        const js = byPath.get(src);
        return js === undefined
          ? match
          : `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
      },
    );
}

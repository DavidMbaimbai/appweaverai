export type SeoValues = {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
};

function escapeAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Adds the project's SEO title, description and social image to the page
 * `<head>`, without overriding tags the page already defines.
 */
export function injectSeoTags(html: string, seo: SeoValues) {
  const title = seo.title?.trim();
  const description = seo.description?.trim();
  const imageUrl = seo.imageUrl?.trim();
  if (!title && !description && !imageUrl) return html;

  const has = (pattern: RegExp) => pattern.test(html);
  const tags: string[] = [];
  const hasTitle = has(/<title[^>]*>\s*\S/i);

  if (title && !hasTitle) tags.push(`<title>${escapeAttr(title)}</title>`);
  if (description && !has(/<meta[^>]+name=["']description["']/i)) {
    tags.push(`<meta name="description" content="${escapeAttr(description)}">`);
  }
  if (title && !has(/<meta[^>]+property=["']og:title["']/i)) {
    tags.push(`<meta property="og:title" content="${escapeAttr(title)}">`);
  }
  if (description && !has(/<meta[^>]+property=["']og:description["']/i)) {
    tags.push(
      `<meta property="og:description" content="${escapeAttr(description)}">`,
    );
  }
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    if (!has(/<meta[^>]+property=["']og:image["']/i)) {
      tags.push(`<meta property="og:image" content="${escapeAttr(imageUrl)}">`);
    }
  }
  if (tags.length === 0) return html;

  const block = tags.join('\n  ');
  if (hasTitle === false && has(/<title[^>]*>\s*<\/title>/i)) {
    html = html.replace(/<title[^>]*>\s*<\/title>/i, '');
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${block}`);
  }
  return `${block}\n${html}`;
}

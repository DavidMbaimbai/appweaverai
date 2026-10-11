export type PageImage = {
  /** Position of the <img> within the page, in document order. */
  index: number;
  src: string;
  alt: string | null;
};

const IMG_TAG = /<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
const ALT_ATTR = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function decode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encode(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attr(tag: string, re: RegExp) {
  const m = tag.match(re);
  if (!m) return null;
  return decode(m[1] ?? m[2] ?? m[3] ?? '');
}

export function listPageImages(html: string): PageImage[] {
  return Array.from(html.matchAll(IMG_TAG)).map((match, index) => ({
    index,
    src: attr(match[0], SRC_ATTR) ?? '',
    alt: attr(match[0], ALT_ATTR),
  }));
}

/**
 * Sets alt text on the images at the given positions. Only the matching
 * <img> tags are rewritten; all other markup is left untouched. An empty
 * string marks an image as decorative (alt="").
 */
export function applyImageAlts(
  html: string,
  alts: Record<number, string>,
): string {
  let index = -1;
  return html.replace(IMG_TAG, (tag) => {
    index += 1;
    if (!(index in alts)) return tag;

    const attrText = ` alt="${encode(alts[index].trim().slice(0, 300))}"`;
    return ALT_ATTR.test(tag)
      ? tag.replace(ALT_ATTR, attrText)
      : tag.replace(/^<img\b/i, (m) => `${m}${attrText}`);
  });
}

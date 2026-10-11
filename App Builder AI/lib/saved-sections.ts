import { parse } from 'node-html-parser';

export type PageSection = { index: number; label: string; html: string };

/** Top-level elements of <body> (or the document root) that can be saved as sections. */
export function extractPageSections(html: string): PageSection[] {
  const root = parse(html);
  const container = root.querySelector('body') ?? root;

  return container.childNodes
    .filter(
      (node) =>
        'tagName' in node &&
        !['SCRIPT', 'STYLE', 'LINK'].includes(
          String((node as { tagName: string }).tagName).toUpperCase(),
        ),
    )
    .map((node, index) => {
      const element = node as ReturnType<typeof parse>;
      const heading = element.querySelector('h1, h2, h3')?.text.trim();
      const tag = String(element.tagName).toLowerCase();
      const id = element.getAttribute('id');
      const label = heading
        ? `${heading.slice(0, 40)} (${tag})`
        : id
          ? `#${id} (${tag})`
          : `${tag} ${index + 1}`;

      return { index, label, html: element.outerHTML };
    });
}

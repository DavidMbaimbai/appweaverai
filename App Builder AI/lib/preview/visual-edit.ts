import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Click-to-edit support for static HTML artifacts. Every element inside
 * `<body>` (excluding `<script>`/`<style>`) is assigned a stable
 * `data-aw-id` in document order when the preview is served. The id is
 * never persisted to disk — `applyVisualEditPatch` re-derives the same
 * ordering from the saved source, applies the patch, then strips the
 * attribute again before writing the file back.
 */

const SKIP_TAGS = new Set(['script', 'style']);

export type VisualEditPatch =
  | { kind: 'text'; text: string }
  | { kind: 'attrs'; attrs: Record<string, string | null> }
  | { kind: 'style'; style: Record<string, string | null> }
  | { kind: 'delete' };

/** CSS properties the visual editor's Style panel may change. */
export const EDITABLE_STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-family',
  'padding',
  'margin',
  'text-align',
] as const;

const UNSAFE_STYLE_VALUE = /[;{}<>\\]|url\s*\(|expression|@import|javascript:/i;

function parseInlineStyle(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (value ?? '').split(';')) {
    const index = part.indexOf(':');
    if (index === -1) continue;
    const property = part.slice(0, index).trim().toLowerCase();
    const propertyValue = part.slice(index + 1).trim();
    if (property && propertyValue) map.set(property, propertyValue);
  }
  return map;
}

/** Merges validated style changes into an inline style attribute value. */
export function mergeInlineStyle(
  existing: string | undefined,
  changes: Record<string, string | null>,
): string {
  const declarations = parseInlineStyle(existing);

  for (const [rawProperty, rawValue] of Object.entries(changes)) {
    const property = rawProperty.toLowerCase();
    if (!(EDITABLE_STYLE_PROPERTIES as readonly string[]).includes(property)) {
      throw new Error(`"${rawProperty}" cannot be edited here.`);
    }

    const value = rawValue?.trim() ?? '';
    if (!value) {
      declarations.delete(property);
      continue;
    }
    if (value.length > 100 || UNSAFE_STYLE_VALUE.test(value)) {
      throw new Error(`"${value}" is not a valid value for ${property}.`);
    }
    declarations.set(property, value);
  }

  return [...declarations].map(([k, v]) => `${k}: ${v}`).join('; ');
}

function walkAssignIds(
  node: HTMLElement,
  counter: { n: number },
  idToNode?: Map<string, HTMLElement>,
) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    const el = child as HTMLElement;
    if (SKIP_TAGS.has(el.rawTagName?.toLowerCase())) continue;

    const id = String(counter.n++);
    el.setAttribute('data-aw-id', id);
    idToNode?.set(id, el);
    walkAssignIds(el, counter, idToNode);
  }
}

/** Adds `data-aw-id` attributes to every editable element for the live preview. */
export function annotateHtmlForVisualEdit(html: string): string {
  const root = parse(html, { comment: true });
  const body = root.querySelector('body');
  if (!body) return html;

  walkAssignIds(body, { n: 0 });
  return root.toString();
}

/** Returns the saved HTML of one element (ids stripped), or null if it is gone. */
export function extractElementHtml(
  html: string,
  elementId: string,
): string | null {
  const root = parse(html, { comment: true });
  const body = root.querySelector('body');
  if (!body) return null;

  const idToNode = new Map<string, HTMLElement>();
  walkAssignIds(body, { n: 0 }, idToNode);
  const target = idToNode.get(elementId);
  if (!target) return null;

  for (const el of root.querySelectorAll('[data-aw-id]')) {
    el.removeAttribute('data-aw-id');
  }
  return target.outerHTML;
}

/**
 * Applies a single visual-edit patch to the saved (un-annotated) HTML
 * source and returns the updated source, with all `data-aw-id` attributes
 * removed again.
 */
export function applyVisualEditPatch(
  html: string,
  elementId: string,
  patch: VisualEditPatch,
): string {
  const root = parse(html, { comment: true });
  const body = root.querySelector('body');
  if (!body) {
    throw new Error('No <body> found in index.html.');
  }

  const idToNode = new Map<string, HTMLElement>();
  walkAssignIds(body, { n: 0 }, idToNode);

  const target = idToNode.get(elementId);
  if (!target) {
    throw new Error(
      'Could not find the selected element — the page may have changed. Refresh and try again.',
    );
  }

  if (patch.kind === 'delete') {
    target.remove();
  } else if (patch.kind === 'text') {
    target.textContent = patch.text;
  } else if (patch.kind === 'style') {
    const next = mergeInlineStyle(target.getAttribute('style'), patch.style);
    if (next) target.setAttribute('style', next);
    else target.removeAttribute('style');
  } else if (patch.kind === 'attrs') {
    for (const [key, value] of Object.entries(patch.attrs)) {
      if (value === null) {
        target.removeAttribute(key);
      } else {
        target.setAttribute(key, value);
      }
    }
  }

  for (const el of root.querySelectorAll('[data-aw-id]')) {
    el.removeAttribute('data-aw-id');
  }

  return root.toString();
}

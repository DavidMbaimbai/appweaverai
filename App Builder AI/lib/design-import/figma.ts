import {
  emptySpec,
  type DesignOutlineNode,
  type DesignSpec,
} from './types';

export type FigmaNode = {
  id: string;
  name?: string;
  type: string;
  characters?: string;
  children?: FigmaNode[];
  fills?: Array<{
    type: string;
    visible?: boolean;
    opacity?: number;
    color?: { r: number; g: number; b: number; a?: number };
  }>;
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number };
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  itemSpacing?: number;
  paddingLeft?: number;
  absoluteBoundingBox?: { width: number; height: number };
};

export type FigmaFileResponse = {
  name?: string;
  document?: FigmaNode;
};

export type FigmaNodesResponse = {
  name?: string;
  nodes?: Record<string, { document?: FigmaNode } | null>;
};

const MAX_FRAMES = 8;
const MAX_DEPTH = 5;
const MAX_NODES_PER_FRAME = 120;
const MAX_COLORS = 16;
const MAX_TEXT_STYLES = 12;
const MAX_COMPONENTS = 40;
const MAX_IMAGES = 12;
const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION']);

export function parseFigmaUrl(raw: string): { fileKey: string; nodeId?: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'figma.com' && !host.endsWith('.figma.com')) return null;
  const match = url.pathname.match(/^\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const rawNode = url.searchParams.get('node-id');
  const nodeId = rawNode ? rawNode.replace(/-/g, ':') : undefined;
  return { fileKey: match[1], nodeId };
}

function toHex(c: { r: number; g: number; b: number }) {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`.toUpperCase();
}

function solidFill(node: FigmaNode) {
  const fill = node.fills?.find(
    (f) => f.type === 'SOLID' && f.visible !== false && f.color && (f.opacity ?? 1) > 0,
  );
  return fill?.color ? toHex(fill.color) : undefined;
}

export function buildFigmaSpec(
  file: FigmaFileResponse,
  options: { nodes?: FigmaNodesResponse; sourceUrl?: string } = {},
): DesignSpec {
  const spec = emptySpec('figma', file.name || 'Figma design');
  spec.sourceUrl = options.sourceUrl;

  const focused = Object.values(options.nodes?.nodes ?? {})
    .map((n) => n?.document)
    .filter((n): n is FigmaNode => Boolean(n));
  const roots: FigmaNode[] = [];
  if (focused.length > 0) {
    roots.push(...focused);
  } else {
    for (const page of file.document?.children ?? []) {
      for (const child of page.children ?? []) roots.push(child);
    }
  }

  const colors = new Map<string, number>();
  const styles = new Map<string, DesignSpec['textStyles'][number]>();
  const components = new Set<string>();

  function collect(node: FigmaNode) {
    const hex = solidFill(node);
    if (hex) colors.set(hex, (colors.get(hex) ?? 0) + 1);
    if (node.type === 'TEXT' && node.style?.fontFamily) {
      const key = `${node.style.fontFamily}|${node.style.fontSize}|${node.style.fontWeight}`;
      const existing = styles.get(key);
      if (existing) existing.count += 1;
      else
        styles.set(key, {
          fontFamily: node.style.fontFamily,
          fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight,
          count: 1,
        });
    }
    if (
      (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE') &&
      node.name
    ) {
      components.add(node.name);
    }
    node.children?.forEach(collect);
  }

  function outline(node: FigmaNode, depth: number, budget: { left: number }): DesignOutlineNode {
    budget.left -= 1;
    const out: DesignOutlineNode = { name: node.name ?? node.type, type: node.type };
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      out.layout = `${node.layoutMode === 'HORIZONTAL' ? 'row' : 'column'}${
        node.itemSpacing ? ` gap ${Math.round(node.itemSpacing)}` : ''
      }${node.paddingLeft ? ` pad ${Math.round(node.paddingLeft)}` : ''}`;
    }
    const box = node.absoluteBoundingBox;
    if (box) out.size = `${Math.round(box.width)}x${Math.round(box.height)}`;
    if (node.type === 'TEXT' && node.characters) out.text = node.characters.slice(0, 120);
    const fill = solidFill(node);
    if (fill) out.fill = fill;
    if (depth < MAX_DEPTH && node.children?.length) {
      const kids: DesignOutlineNode[] = [];
      for (const child of node.children) {
        if (budget.left <= 0) break;
        kids.push(outline(child, depth + 1, budget));
      }
      if (kids.length) out.children = kids;
    }
    return out;
  }

  const frames = roots
    .flatMap((r) => (r.type === 'CANVAS' ? (r.children ?? []) : [r]))
    .filter((n) => FRAME_TYPES.has(n.type) || focused.length > 0)
    .slice(0, MAX_FRAMES);

  for (const frame of frames) {
    collect(frame);
    const box = frame.absoluteBoundingBox;
    spec.frames.push({
      id: frame.id,
      name: frame.name ?? frame.id,
      width: box ? Math.round(box.width) : undefined,
      height: box ? Math.round(box.height) : undefined,
      outline: outline(frame, 0, { left: MAX_NODES_PER_FRAME }),
    });
  }

  spec.colors = [...colors.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COLORS);
  spec.textStyles = [...styles.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TEXT_STYLES);
  spec.fonts = [...new Set(spec.textStyles.map((s) => s.fontFamily))];
  spec.components = [...components].slice(0, MAX_COMPONENTS);
  return spec;
}

async function figmaGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.figma.com${path}`, {
    headers: { 'X-Figma-Token': token },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (response.status === 403 || response.status === 401) {
    throw new Error('Figma rejected the access token or you lack access to this file.');
  }
  if (response.status === 404) throw new Error('Figma file not found.');
  if (response.status === 429) throw new Error('Figma rate limit reached. Try again shortly.');
  if (!response.ok) throw new Error(`Figma API error (${response.status}).`);
  return (await response.json()) as T;
}

/** Fetches a Figma design with a one-off token. The token is never stored. */
export async function fetchFigmaDesign(url: string, token: string): Promise<DesignSpec> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) throw new Error('That does not look like a Figma file URL.');
  const key = encodeURIComponent(parsed.fileKey);

  let file: FigmaFileResponse;
  let nodes: FigmaNodesResponse | undefined;
  if (parsed.nodeId) {
    nodes = await figmaGet<FigmaNodesResponse>(
      `/v1/files/${key}/nodes?ids=${encodeURIComponent(parsed.nodeId)}&depth=8`,
      token,
    );
    file = { name: nodes.name };
  } else {
    file = await figmaGet<FigmaFileResponse>(`/v1/files/${key}?depth=4`, token);
  }

  const spec = buildFigmaSpec(file, { nodes, sourceUrl: url });
  const ids = spec.frames.map((f) => f.id).slice(0, MAX_IMAGES);
  if (ids.length > 0) {
    try {
      const res = await figmaGet<{ images?: Record<string, string | null> }>(
        `/v1/images/${key}?ids=${encodeURIComponent(ids.join(','))}&format=png&scale=1`,
        token,
      );
      spec.images = ids
        .filter((id) => res.images?.[id])
        .map((id) => ({
          nodeId: id,
          name: spec.frames.find((f) => f.id === id)?.name ?? id,
          url: res.images?.[id] as string,
        }));
    } catch {
      // Frame previews are optional.
    }
  }
  return spec;
}

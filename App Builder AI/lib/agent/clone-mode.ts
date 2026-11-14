/**
 * lib/agent/clone-mode.ts
 *
 * Clone-mode prompt block, the two extra tools, their handler, and the
 * complete_build gate. Wire it into your existing agent file as shown at the
 * bottom (INTEGRATION).
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  readReferenceSection,
  type ViewportName,
} from '@/lib/clone/capture-reference';
import {
  compareToReference,
  summarizeCompare,
  MAX_FIX_ROUNDS,
} from '@/lib/clone/compare-to-reference';

export const CLONE_MODE_BLOCK = [
  'Clone mode (a reference URL or Figma file was captured):',
  '1. The artifact is ALREADY pre-seeded with a faithful snapshot of the reference. Do NOT rebuild it from scratch and do NOT rewrite files wholesale. Use list_files, read_file and edit_file.',
  '2. The reference is the single source of truth. IGNORE any generic "website type" or template text (portfolio, landing page, etc.). Keep the original sections, order, copy, nav items, imagery and brand.',
  '3. Use the captured design tokens, fonts and assets verbatim. Never invent a new palette, typography, copy, or stock imagery. No lorem ipsum.',
  '4. Preserve rendered output. Only change what the user explicitly asks for; any refactor (splitting into components, renaming classes, cleaning markup) must not change how the page looks.',
  '5. Frontend only unless the user asks for a backend. Skip the full-stack/backend requirements entirely.',
  '6. Use fetch_reference_section(viewport, index) to inspect one section (HTML + screenshot) before editing it.',
  `7. Before complete_build, call compare_to_reference. Fix the worst sections (topmost mismatch first) and re-run. You have at most ${MAX_FIX_ROUNDS} comparison rounds; complete_build is rejected until the comparison passes or the rounds are used up.`,
  '8. In your final summary, state the final mismatch figures and anything that could not be matched (dynamic content, scripts, blocked assets, fonts).',
].join('\n');

export const CLONE_MODE_TOOLS = [
  {
    name: 'fetch_reference_section',
    description:
      'Get the original HTML (desktop only) and a cropped screenshot for ONE section of the captured reference, to compare against your current output. Section indexes come from the reference outline in the system prompt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        viewport: { type: 'string', enum: ['desktop', 'tablet', 'mobile'] },
        index: { type: 'integer', description: 'Section index from the outline' },
      },
      required: ['viewport', 'index'],
    },
  },
  {
    name: 'compare_to_reference',
    description:
      'Render the current preview at the same viewports as the reference, diff it against the reference screenshots and return per-section mismatch with the worst offenders and a diff image. Call before complete_build and after each round of fixes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        viewports: {
          type: 'array',
          items: { type: 'string', enum: ['desktop', 'tablet', 'mobile'] },
          description: 'Defaults to desktop and mobile',
        },
      },
      required: [] as string[],
    },
  },
] satisfies Anthropic.Tool[];

export interface CloneSession {
  refDir: string; // where captureReference wrote manifest.json
  diffDir: string; // where diff images are written
  rounds: number;
  lastPassed: boolean;
}

/** Call inside your complete_build handler, before accepting it. */
export function canCompleteBuild(s: CloneSession): { ok: boolean; reason?: string } {
  if (s.lastPassed || s.rounds >= MAX_FIX_ROUNDS) return { ok: true };
  return {
    ok: false,
    reason:
      s.rounds === 0
        ? 'Run compare_to_reference before complete_build.'
        : `The last comparison did not pass. Fix the worst sections and re-run compare_to_reference (${s.rounds}/${MAX_FIX_ROUNDS} rounds used).`,
  };
}

/** Dispatch for the two clone tools. `getPreviewUrl` must return the live preview URL. */
export async function handleCloneTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { session: CloneSession; getPreviewUrl: () => Promise<string> },
): Promise<Anthropic.ToolResultBlockParam['content']> {
  if (name === 'fetch_reference_section') {
    const res = await readReferenceSection(
      ctx.session.refDir,
      input.viewport as ViewportName,
      Number(input.index),
    );
    if (!res) return [{ type: 'text', text: 'Section data not found.' }];
    const { section, screenshotBase64 } = res;
    return [
      {
        type: 'text',
        text: JSON.stringify(
          { index: section.index, tag: section.tag, top: section.top, height: section.height, text: section.text, html: section.html ?? '(HTML stored for desktop only)' },
          null,
          2,
        ),
      },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
    ];
  }

  if (name === 'compare_to_reference') {
    const result = await compareToReference({
      previewUrl: await ctx.getPreviewUrl(),
      refDir: ctx.session.refDir,
      outDir: ctx.session.diffDir,
      viewports: (input.viewports as ViewportName[] | undefined) ?? ['desktop', 'mobile'],
    });
    ctx.session.rounds += 1;
    ctx.session.lastPassed = result.passed;
    const content: Anthropic.ToolResultBlockParam['content'] = [
      { type: 'text', text: summarizeCompare(result) },
    ];
    const img = result.viewports.find((v) => v.worstSectionDiffBase64)?.worstSectionDiffBase64;
    if (img) {
      content.push({ type: 'text', text: 'Diff of the worst section (red = differing pixels):' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } });
    }
    return content;
  }

  throw new Error(`Unknown clone tool: ${name}`);
}

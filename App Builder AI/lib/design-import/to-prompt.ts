import type { DesignOutlineNode, DesignSpec } from './types';

export type DesignOutcome = 'visual-reference' | 'imported-design' | 'functional-app';

export const OUTCOME_LABELS: Record<DesignOutcome, { title: string; description: string }> = {
  'visual-reference': {
    title: 'Visual reference',
    description: 'A screenshot guides the look; the builder interprets it freely.',
  },
  'imported-design': {
    title: 'Imported design',
    description: 'Figma or a website is converted into editable components.',
  },
  'functional-app': {
    title: 'Functional imported application',
    description: 'A GitHub repository (including Lovable exports) with its real code.',
  },
};

function renderOutline(node: DesignOutlineNode, indent: number, lines: string[]) {
  const bits = [node.type, node.name];
  if (node.size) bits.push(node.size);
  if (node.layout) bits.push(node.layout);
  if (node.fill) bits.push(node.fill);
  if (node.text) bits.push(`"${node.text.replace(/\s+/g, ' ')}"`);
  lines.push(`${'  '.repeat(indent)}- ${bits.join(' · ')}`);
  node.children?.forEach((c) => renderOutline(c, indent + 1, lines));
}

export function designSpecToPrompt(spec: DesignSpec, userNotes = ''): string {
  const out: string[] = [];
  const origin =
    spec.source === 'figma'
      ? 'a Figma design'
      : spec.source === 'url'
        ? 'an existing website'
        : 'a reference screenshot';
  out.push(
    `Recreate ${origin} ("${spec.name}") faithfully as a working app. Match layout, spacing, typography and colours closely.`,
    'Build the UI as clean, editable, reusable components (no flattened images of text), make it responsive, and wire it to working functionality: navigation, forms with validation, buttons that do something, and realistic persisted data where the design implies it.',
  );
  if (spec.sourceUrl) out.push(`Source: ${spec.sourceUrl}`);

  if (spec.colors.length) {
    out.push(`\nColour tokens (most used first): ${spec.colors.map((c) => c.hex).join(', ')}. Define them as CSS variables / theme tokens.`);
  }
  if (spec.textStyles.length) {
    out.push(
      '\nTypography:',
      ...spec.textStyles.map(
        (s) =>
          `- ${s.fontFamily}${s.fontSize ? ` ${s.fontSize}px` : ''}${s.fontWeight ? ` weight ${s.fontWeight}` : ''}`,
      ),
    );
  } else if (spec.fonts.length) {
    out.push(`\nFonts: ${spec.fonts.join(', ')}`);
  }
  if (spec.components.length) {
    out.push(`\nNamed design components to implement as React components: ${spec.components.join(', ')}.`);
  }
  if (spec.headings.length) {
    out.push('\nContent headings:', ...spec.headings.map((h) => `- ${h}`));
  }
  if (spec.notes.length) out.push('\nNotes:', ...spec.notes.map((n) => `- ${n}`));

  for (const frame of spec.frames) {
    out.push(
      `\nScreen "${frame.name}"${frame.width ? ` (${frame.width}x${frame.height})` : ''} — layout hierarchy:`,
    );
    renderOutline(frame.outline, 0, out);
  }
  if (spec.images.length) {
    out.push(
      '\nReference previews (exported by Figma, temporary links):',
      ...spec.images.map((i) => `- ${i.name}: ${i.url}`),
    );
  }
  if (userNotes.trim()) out.push(`\nAdditional instructions from the user: ${userNotes.trim()}`);
  return out.join('\n').slice(0, 24_000);
}

export function screenshotPrompt(userNotes = ''): string {
  return [
    'The attached screenshot is a visual reference. Recreate its look and layout faithfully as a working app, built from clean, editable, reusable components.',
    'Infer colours, typography, spacing and structure from the image, make it responsive, and wire it to working functionality (navigation, forms, persisted data where implied).',
    userNotes.trim() ? `Additional instructions from the user: ${userNotes.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

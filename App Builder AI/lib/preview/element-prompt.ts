const MAX_SNIPPET = 1500;

/** Prompt that scopes an AI edit to the one element the user selected. */
export function buildElementEditPrompt({
  instruction,
  tag,
  html,
}: {
  instruction: string;
  tag: string;
  html: string;
}): string {
  const snippet =
    html.length > MAX_SNIPPET ? `${html.slice(0, MAX_SNIPPET)}…` : html;

  return [
    `Edit only the selected <${tag}> element on my page: ${instruction.trim()}`,
    '',
    'Selected element:',
    '```html',
    snippet,
    '```',
    '',
    'Change only this element (and its contents). Leave every other part of the website exactly as it is.',
  ].join('\n');
}

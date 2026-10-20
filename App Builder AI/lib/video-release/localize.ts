import { getAnthropicClient } from '@/lib/anthropic';
import { normalizeHashtags } from '@/lib/project-marketing/logic';

const MODEL = process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

export const MAX_LANGUAGES = 6;

const LOCALIZE_SYSTEM = `You localize a video's title, caption and hashtags into other languages.

Rules:
- Translate and culturally adapt ONLY what is given. Never add facts, statistics, claims, prices, links or calls to action that are not in the source.
- Keep brand and product names unchanged. Keep each language's title short and natural.
- "hashtags": 0-5 words without the # sign, in that language.
Return ONLY JSON: {"variants": [{"language": "<requested code>", "title": "...", "caption": "...", "hashtags": ["..."]}]}`;

export type VariantCopy = { language: string; title: string; caption: string; hashtags: string[] };

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

export function normalizeLanguages(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(String) : [];
  return [...new Set(raw.map((l) => l.trim()).filter((l) => LANGUAGE.test(l)))].slice(0, MAX_LANGUAGES);
}

/** Parses model output; only the requested languages are accepted and each needs a title. */
export function parseVariants(raw: string, requested: string[]): VariantCopy[] {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  try {
    const data = JSON.parse(json) as { variants?: Partial<VariantCopy>[] };
    const out: VariantCopy[] = [];
    for (const v of data.variants ?? []) {
      if (!v.language || !requested.includes(v.language) || typeof v.title !== 'string' || !v.title.trim()) continue;
      if (out.some((o) => o.language === v.language)) continue;
      out.push({
        language: v.language,
        title: v.title.trim().slice(0, 100),
        caption: typeof v.caption === 'string' ? v.caption.trim() : '',
        hashtags: normalizeHashtags(v.hashtags ?? []).slice(0, 5),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function localizeCopy(
  source: { language: string; title: string; caption: string; hashtags: string[] },
  languages: string[],
): Promise<VariantCopy[]> {
  const targets = languages.filter((l) => l !== source.language);
  if (targets.length === 0) return [];
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: LOCALIZE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Source language: ${source.language}\nTitle: ${source.title}\nCaption: ${source.caption || '(none)'}\nHashtags: ${source.hashtags.join(', ') || '(none)'}\nTarget languages: ${targets.join(', ')}`,
      },
    ],
  });
  const block = response.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? parseVariants(block.text, targets) : [];
}

/** Translates subtitle lines one-to-one; returns null when the count does not match so nothing is mis-timed. */
export async function translateLines(lines: string[], language: string): Promise<string[] | null> {
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system:
      'Translate each line into the requested language. Translate only; add nothing. Return ONLY a JSON array of strings with exactly as many items as the input array.',
    messages: [{ role: 'user', content: `Language: ${language}\n${JSON.stringify(lines)}` }],
  });
  const block = response.content.find((c) => c.type === 'text');
  const json = block && block.type === 'text' ? block.text.match(/\[[\s\S]*\]/)?.[0] : null;
  try {
    const parsed = json ? (JSON.parse(json) as unknown) : null;
    return Array.isArray(parsed) && parsed.length === lines.length && parsed.every((p) => typeof p === 'string')
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

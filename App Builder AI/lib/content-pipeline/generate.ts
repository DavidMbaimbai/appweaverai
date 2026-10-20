import { buildUntrustedCall } from '@/lib/agents/untrusted';
import { getAnthropicClient } from '@/lib/anthropic';
import { normalizeHashtags } from '@/lib/project-marketing/logic';
import { isSafeAdText } from '@/lib/social/adverts';

import { SUPPORTED_LANGUAGES } from './types';

const MODEL = process.env.BEDROCK_MODEL_ID?.trim() || 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

export type ProductFacts = {
  name: string;
  description: string | null;
  url: string | null;
  brand: string | null;
  knowledge: string[];
  /** Extra approved facts (platform scope). */
  approvedFacts?: string | null;
};

export type GeneratedItem = {
  platform: string;
  language: string;
  text: string;
  hashtags: string[];
};

export type GeneratedIdea = {
  idea: string;
  imagePrompt: string | null;
  videoPrompt: string | null;
  items: GeneratedItem[];
};

const SYSTEM = `You write one day's organic social content for a product, using ONLY the facts the user message provides.

Rules:
- Never invent statistics, customer counts, testimonials, reviews, awards, prices, discounts, guarantees, features or any claim not in the facts. If a detail is missing, stay general.
- No superlatives you cannot prove, no health/financial-return claims, nothing about investing or fundraising.
- Include the product link only if a "Website" URL is given, exactly as written; never a placeholder or any other link.
- Every idea must be clearly different from the "recent posts" list (new angle, new wording).
- Write each item natively in its language (not word-for-word translation), matching the platform's tone. X items must be at most 270 characters including hashtags and link.
- "hashtags": 0-3 words without the # sign. Add a short call to action with the link where it fits.
Return ONLY JSON: {"ideas":[{"idea":"short angle","imagePrompt":"visual description without text or logos","videoPrompt":"one-scene video description without text or logos","items":[{"platform":"X","language":"en","text":"...","hashtags":["..."]}]}]}
Every idea must have exactly one item per requested platform and language.`;

export function buildGenerationPrompt(args: {
  facts: ProductFacts;
  platforms: string[];
  languages: string[];
  count: number;
  objective: string;
  recent: string[];
}) {
  const langs = args.languages.map((l) => `${l} (${SUPPORTED_LANGUAGES[l] ?? l})`).join(', ');
  return buildUntrustedCall({
    system: SYSTEM,
    task: [
      `Ideas to write: ${args.count}`,
      `Platforms: ${args.platforms.join(', ')}`,
      `Languages: ${langs}`,
      `Objective: ${args.objective.trim() || 'grow awareness and visits'}`,
      `Product: ${args.facts.name}`,
      `Description: ${args.facts.description?.trim() || 'not provided'}`,
      `Website: ${args.facts.url ?? 'not published yet (do not include any link)'}`,
      `Brand: ${args.facts.brand || 'not provided'}`,
      `Approved facts: ${args.facts.approvedFacts?.trim() || 'none beyond the above'}`,
    ].join('\n'),
    untrusted: [
      { label: 'knowledge', content: args.facts.knowledge.join('\n---\n') || 'none', maxLength: 4000, redact: true },
      { label: 'recent_posts', content: args.recent.map((t) => `- ${t.slice(0, 300)}`).join('\n') || 'none', maxLength: 6000 },
    ],
  });
}

export function parseIdeas(raw: string, platforms: string[], languages: string[]): GeneratedIdea[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: { ideas?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.ideas)) return [];
  const ideas: GeneratedIdea[] = [];
  for (const entry of parsed.ideas as Array<Record<string, unknown>>) {
    const items: GeneratedItem[] = [];
    for (const item of Array.isArray(entry.items) ? (entry.items as Array<Record<string, unknown>>) : []) {
      const platform = typeof item.platform === 'string' ? item.platform.toUpperCase() : '';
      const language = typeof item.language === 'string' ? item.language.toLowerCase() : '';
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!platforms.includes(platform) || !languages.includes(language) || !text) continue;
      if (!isSafeAdText(text)) continue;
      items.push({ platform, language, text, hashtags: normalizeHashtags(item.hashtags) });
    }
    if (!items.length) continue;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : null);
    ideas.push({
      idea: str(entry.idea) ?? 'Daily post',
      imagePrompt: str(entry.imagePrompt),
      videoPrompt: str(entry.videoPrompt),
      items,
    });
  }
  return ideas;
}

export async function generateIdeas(args: {
  facts: ProductFacts;
  platforms: string[];
  languages: string[];
  count: number;
  objective: string;
  recent: string[];
}): Promise<{ ideas: GeneratedIdea[]; flags: string[] }> {
  const call = buildGenerationPrompt(args);
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: call.system,
    messages: call.messages,
  });
  const block = response.content.find((c) => c.type === 'text');
  const text = block && block.type === 'text' ? block.text : '';
  return { ideas: parseIdeas(text, args.platforms, args.languages), flags: call.flags };
}

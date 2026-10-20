import { getAnthropicClient } from '@/lib/anthropic';
import { isSafeAdText } from '@/lib/social/adverts';

const MODEL =
  process.env.BEDROCK_MODEL_ID?.trim() ||
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

const SYSTEM_PROMPT = `You write paid Facebook/Instagram adverts for AppWeaver AI (https://appweaverai.com), a product that turns plain-language ideas into real, running web apps with an AI agent, live preview, publishing and custom domains. The goal is new sign-ups.

Rules:
- Use only the product facts above and any "Approved facts". Never invent statistics, user counts, customers, testimonials, reviews, awards, prices, discounts or guarantees.
- No superlatives you cannot prove, no "free" unless approved, no investing/funding talk, no claims about the viewer's personal traits or situation.
- "headline": at most 40 characters. "primaryText": at most 125 characters, one clear benefit and a call to action.
- "imagePrompt": a vivid description of a clean, modern, eye-catching illustration or photo that fits the ad. It must contain no text, letters, logos or people's faces.
Return ONLY JSON: {"headline": "...", "primaryText": "...", "imagePrompt": "..."}`;

export type AdCopy = { headline: string; primaryText: string; imagePrompt: string };

export function parseAdCopy(text: string): AdCopy | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
  const primaryText = typeof parsed.primaryText === 'string' ? parsed.primaryText.trim() : '';
  const imagePrompt = typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : '';
  if (!headline || !primaryText || !imagePrompt) return null;
  if (headline.length > 40 || primaryText.length > 125) return null;
  if (!isSafeAdText(`${headline} ${primaryText}`)) return null;
  return { headline, primaryText, imagePrompt };
}

export async function generateAdCopy(winners: string[], recent: string[]): Promise<AdCopy | null> {
  const facts = process.env.SOCIAL_AD_FACTS?.trim() || 'none';
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Approved facts: ${facts}\nBest-performing adverts so far (write something in a similar spirit, not a copy):\n${winners.join('\n') || 'none yet'}\nDo not repeat these:\n${recent.join('\n') || 'none'}`,
      },
    ],
  });
  const block = response.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? parseAdCopy(block.text) : null;
}

const CUSTOMER_SYSTEM = `You write a paid Facebook/Instagram advert for a small business, using ONLY the brief the user gives. The goal is clicks to their website.

Rules:
- Never invent statistics, customer counts, testimonials, reviews, awards, prices, discounts, guarantees or claims not in the brief.
- No superlatives you cannot prove, no health, financial-return, employment or housing claims, nothing about the viewer's personal traits, no investing talk.
- "headline": at most 40 characters. "primaryText": at most 125 characters, one clear benefit and a call to action.
- "imagePrompt": a vivid description of a clean, modern, eye-catching image that fits the ad. No text, letters, logos or people's faces.
Return ONLY JSON: {"headline": "...", "primaryText": "...", "imagePrompt": "..."}`;

export async function generateCustomerAdCopy(brief: string): Promise<AdCopy | null> {
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: CUSTOMER_SYSTEM,
    messages: [{ role: 'user', content: brief }],
  });
  const block = response.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? parseAdCopy(block.text) : null;
}
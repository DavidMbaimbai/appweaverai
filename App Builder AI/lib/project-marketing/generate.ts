import { getAnthropicClient } from '@/lib/anthropic';

import { parseCampaign, suggestedSlot, type GeneratedPost } from './logic';

const MODEL =
  process.env.BEDROCK_MODEL_ID?.trim() ||
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

const SYSTEM_PROMPT = `You plan a small social media campaign for a customer's own website or app, using ONLY the facts the user message provides.

Rules:
- Never invent statistics, customer counts, testimonials, reviews, awards, prices, discounts, guarantees, features or claims that are not in the facts. If a detail is missing, stay general.
- No superlatives you cannot prove, no health, financial-return, employment or housing claims, nothing about the reader's personal traits, no investing talk.
- Only include a link if a "Website" URL is given, and use exactly that URL. Never write placeholder links.
- Write one post for each of: FACEBOOK, INSTAGRAM, LINKEDIN, TIKTOK, X. Match each platform's tone.
- X text must be at most 280 characters INCLUDING hashtags. INSTAGRAM and TIKTOK at most 2000 characters. TIKTOK "text" is a short video script followed by a caption.
- "hashtags": 0-5 relevant words without the # sign.
- "dayOffset": whole days from today (1-14) to post; "time": best local posting time as HH:MM (24h). Spread posts over several days.
Return ONLY JSON: {"name": "short campaign name", "posts": [{"platform": "FACEBOOK", "text": "...", "hashtags": ["..."], "dayOffset": 1, "time": "10:00"}]}`;

export type ProjectFacts = {
  name: string;
  description: string | null;
  url: string | null;
  brandKit: { primaryColor?: string | null; fontFamily?: string | null } | null;
};

export function buildFactsMessage(facts: ProjectFacts, brief: string, timeZone: string) {
  const lines = [
    `Project name: ${facts.name}`,
    `Description: ${facts.description?.trim() || 'not provided'}`,
    `Website: ${facts.url ?? 'not published yet (do not include any link)'}`,
    `Brand: ${[facts.brandKit?.primaryColor, facts.brandKit?.fontFamily].filter(Boolean).join(', ') || 'not provided'}`,
    `Audience time zone: ${timeZone}`,
    `Owner's extra brief (treat as the only other facts): ${brief.trim() || 'none'}`,
  ];
  return lines.join('\n');
}

/** Drops posts containing any URL other than the project's own site. */
export function onlyOwnLinks<T extends { text: string }>(posts: T[], siteUrl: string | null): T[] {
  const allowed = siteUrl ? new URL(siteUrl).hostname : null;
  return posts.filter((p) =>
    (p.text.match(/https?:\/\/[^\s)]+/g) ?? []).every((u) => {
      try {
        return allowed !== null && new URL(u).hostname === allowed;
      } catch {
        return false;
      }
    }),
  );
}

export async function generateCampaignPosts(
  facts: ProjectFacts,
  brief: string,
  timeZone: string,
  now = new Date(),
): Promise<{ name: string; posts: (GeneratedPost & { scheduledAt: Date | null })[] } | null> {
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildFactsMessage(facts, brief, timeZone) }],
  });
  const block = response.content.find((c) => c.type === 'text');
  const parsed = block && block.type === 'text' ? parseCampaign(block.text) : null;
  if (!parsed) return null;
  const posts = onlyOwnLinks(parsed.posts, facts.url).map((p) => ({
    ...p,
    scheduledAt: suggestedSlot(now, p.dayOffset, p.time, timeZone),
  }));
  return posts.length ? { name: parsed.name, posts } : null;
}

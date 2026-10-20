import { getAnthropicClient } from '@/lib/anthropic';
import { prisma } from '@/lib/prisma';

const AD_MODEL =
  process.env.BEDROCK_MODEL_ID?.trim() ||
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

const ANGLES = [
  'build an app from a plain-language idea',
  'live preview while the AI builds',
  'publish in one click',
  'custom domains for your app',
  'no coding experience needed',
  'founders validating an idea fast',
  'small businesses getting their own app',
  'from idea to running web app in minutes',
];

const SYSTEM_PROMPT = `You write organic social media adverts for AppWeaver AI (https://appweaverai.com), a product that turns plain-language ideas into real, running web apps with an AI agent, live preview, publishing and custom domains.

Rules:
- Use only the product facts above and any "Approved facts" given. Never invent statistics, user counts, customer names, testimonials, reviews, awards, prices, discounts, or guarantees.
- No superlatives you cannot prove ("#1", "best", "guaranteed", "free" unless approved).
- Do not mention investing, funding, valuation or fundraising.
- 1 to 3 sentences, friendly and specific, end with the URL https://appweaverai.com, at most 3 relevant hashtags.
- Under 260 characters in total so it fits every platform.
Return ONLY JSON: {"title": "<short internal title>", "message": "<advert text>"}`;

const BANNED =
  /\b(guarantee[sd]?|#1|number one|best in|award[- ]winning|risk[- ]free|invest(?:ment|or|ors)?|fundrais\w*|valuation|\d+\s?%|\d[\d,]*\+?\s+(?:users|customers|apps))\b/i;

export type Advert = { title: string; message: string };

export function isSafeAdText(text: string) {
  return !BANNED.test(text);
}

export function parseAdvert(text: string): Advert | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: { title?: unknown; message?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!title || !message || message.length > 280) return null;
  if (!message.includes('appweaverai.com')) return null;
  if (BANNED.test(message)) return null;
  return { title: title.slice(0, 120), message };
}

function queueTarget() {
  const n = Number(process.env.SOCIAL_AD_MIN_QUEUE);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 2;
}

export function advertsEnabled() {
  return process.env.SOCIAL_AD_AUTOGEN !== 'false';
}

/** Keeps the post queue stocked by writing new adverts when it runs low. */
export async function ensureAdvertQueue() {
  if (!advertsEnabled()) return { created: 0, reason: 'Disabled.' };

  const pending = await prisma.socialPost.count({ where: { status: 'PENDING' } });
  const missing = queueTarget() - pending;
  if (missing <= 0) return { created: 0, reason: 'Queue is stocked.' };

  const recent = await prisma.socialPost.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { message: true },
  });
  const facts = process.env.SOCIAL_AD_FACTS?.trim();
  let created = 0;

  for (let i = 0; i < missing; i += 1) {
    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
    const avoid = recent.map((p) => `- ${p.message}`).join('\n');
    try {
      const response = await getAnthropicClient().messages.create({
        model: AD_MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Angle: ${angle}\nApproved facts: ${facts || 'none'}\nDo not repeat these recent posts:\n${avoid || 'none'}`,
          },
        ],
      });
      const block = response.content.find((c) => c.type === 'text');
      const advert = block && block.type === 'text' ? parseAdvert(block.text) : null;
      if (!advert) continue;

      await prisma.socialPost.create({
        data: { title: advert.title, message: advert.message, platforms: [] },
      });
      recent.unshift({ message: advert.message });
      created += 1;
    } catch (error) {
      console.error('[social] advert generation failed:', error);
      break;
    }
  }

  return { created };
}

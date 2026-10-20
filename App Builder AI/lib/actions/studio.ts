'use server';

import { generateAdImage } from '@/lib/ads/image';
import { getAnthropicClient } from '@/lib/anthropic';
import { requireUserId } from '@/lib/auth/require-user';
import { rateLimit } from '@/lib/rate-limit';
import {
  isStudioToolId,
  MAX_BRIEF_LENGTH,
  STUDIO_TOOLS,
} from '@/lib/studio/tools';

const MODEL =
  process.env.BEDROCK_MODEL_ID?.trim() ||
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

const SYSTEM = `You are the marketing, advertising, design and product strategist inside AppWeaver AI. Produce practical, ready-to-use work for the user's own business from their brief.
Rules: never invent statistics, customer counts, testimonials, awards or guarantees for the user's business; mark anything you assume with "(assumption)". Do not make medical, financial-return or legal claims. Be concise and well structured in markdown.`;

export type StudioResult =
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'image'; imageBase64: string }
  | { ok: false; error: string };

export async function runStudioAction(
  toolId: unknown,
  brief: unknown,
): Promise<StudioResult> {
  const auth = await requireUserId();
  if (auth.error || !auth.userId) {
    return { ok: false, error: auth.error ?? 'You must be signed in.' };
  }
  if (!isStudioToolId(toolId)) return { ok: false, error: 'Unknown tool.' };
  const text = typeof brief === 'string' ? brief.trim() : '';
  if (text.length < 10) return { ok: false, error: 'Please describe what you need.' };
  if (text.length > MAX_BRIEF_LENGTH) return { ok: false, error: 'Brief is too long.' };

  const limit = await rateLimit(`studio:${auth.userId}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return { ok: false, error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };
  }

  try {
    if (toolId === 'image') {
      return { ok: true, kind: 'image', imageBase64: await generateAdImage(text) };
    }
    const tool = STUDIO_TOOLS.find((t) => t.id === toolId);
    const response = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: `${SYSTEM}\n\nTask: ${tool?.task}`,
      messages: [{ role: 'user', content: text }],
    });
    const block = response.content.find((c) => c.type === 'text');
    const out = block && block.type === 'text' ? block.text.trim() : '';
    if (!out) return { ok: false, error: 'No result. Please try again.' };
    return { ok: true, kind: 'text', text: out };
  } catch (error) {
    console.error('[studio] failed:', error);
    return { ok: false, error: 'Generation failed. Please try again.' };
  }
}

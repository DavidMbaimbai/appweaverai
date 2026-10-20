'use server';

import { generateAdImage } from '@/lib/ads/image';
import { getAnthropicClient } from '@/lib/anthropic';
import { prisma } from '@/lib/prisma';
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
    const out = await generateText(tool?.task ?? '', text);
    if (!out) return { ok: false, error: 'No result. Please try again.' };
    return { ok: true, kind: 'text', text: out };
  } catch (error) {
    console.error('[studio] failed:', error);
    return { ok: false, error: 'Generation failed. Please try again.' };
  }
}

async function generateText(task: string, brief: string) {
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: `${SYSTEM}\n\nTask: ${task}`,
    messages: [{ role: 'user', content: brief }],
  });
  const block = response.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? block.text.trim() : '';
}

const BUILD_PROMPT_TASK = `Write ONE prompt for an AI app builder that builds the user's product. It must describe the app and its core features, and require a polished, conversion-focused landing page (hero, benefits, how it works, pricing placeholder, sign-up call to action). Apply the brand colours (hex), fonts and voice from the brand kit provided. Do not invent customers, statistics or testimonials. Output only the prompt, under 1500 characters.`;

export type LaunchKitResult =
  | { ok: true; brand: string; adPack: string; plan: string; buildPrompt: string }
  | { ok: false; error: string };

/** One brief in: brand kit, ad pack, launch plan and a ready build prompt out. */
export async function generateLaunchKitAction(brief: unknown): Promise<LaunchKitResult> {
  const auth = await requireUserId();
  if (auth.error || !auth.userId) {
    return { ok: false, error: auth.error ?? 'You must be signed in.' };
  }
  const text = typeof brief === 'string' ? brief.trim() : '';
  if (text.length < 10) return { ok: false, error: 'Please describe your idea.' };
  if (text.length > MAX_BRIEF_LENGTH) return { ok: false, error: 'Brief is too long.' };

  const limit = await rateLimit(`studio-launch:${auth.userId}`, 5, 60 * 60 * 1000);
  if (!limit.ok) {
    return { ok: false, error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };
  }

  const task = (id: string) => STUDIO_TOOLS.find((t) => t.id === id)?.task ?? '';
  try {
    const brand = await generateText(task('brand-kit'), text);
    const [adPack, plan, buildPrompt] = await Promise.all([
      generateText(task('ad-pack'), `${text}\n\nBrand kit:\n${brand}`),
      generateText(task('launch-plan'), `${text}\n\nBrand kit:\n${brand}`),
      generateText(BUILD_PROMPT_TASK, `${text}\n\nBrand kit:\n${brand}`),
    ]);
    if (!brand || !adPack || !plan || !buildPrompt) {
      return { ok: false, error: 'No result. Please try again.' };
    }
    await prisma.launchKit.create({
      data: { userId: auth.userId, brief: text, brand, adPack, plan, buildPrompt: buildPrompt.slice(0, 1800) },
    });
    return { ok: true, brand, adPack, plan, buildPrompt: buildPrompt.slice(0, 1800) };
  } catch (error) {
    console.error('[studio] launch kit failed:', error);
    return { ok: false, error: 'Generation failed. Please try again.' };
  }
}

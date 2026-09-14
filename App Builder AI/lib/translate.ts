import { getAnthropicClient } from '@/lib/anthropic';

const TRANSLATE_MODEL = 'claude-3-5-haiku-latest';

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  return JSON.parse(raw);
}

/**
 * Detects the language of `text` and, if it isn't English, translates it to
 * English. Returns `null` on any failure (best-effort — callers should treat
 * translation as optional enrichment, never block on it).
 */
export async function detectAndTranslateToEnglish(
  text: string,
): Promise<{ language: string; englishTranslation: string | null } | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 1024,
      system:
        'You detect the language of a short piece of user text and translate it to English if needed. ' +
        'Respond with ONLY a JSON object, no markdown fences, no commentary: ' +
        '{"language": "<English name of the detected language, e.g. \\"Spanish\\" or \\"English\\">", ' +
        '"englishTranslation": "<the text translated to natural English, or null if the text is already in English>"}',
      messages: [{ role: 'user', content: trimmed }],
    });

    const block = response.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') return null;

    const parsed = extractJson(block.text) as {
      language?: string;
      englishTranslation?: string | null;
    };

    if (!parsed.language) return null;

    const isEnglish = parsed.language.trim().toLowerCase() === 'english';
    return {
      language: parsed.language.trim(),
      englishTranslation: isEnglish ? null : (parsed.englishTranslation ?? null),
    };
  } catch (error) {
    console.error('Translation (detect + to-English) failed:', error);
    return null;
  }
}

/**
 * Translates `text` (assumed to be English) into `targetLanguage` (an
 * English language name, e.g. "Spanish"). Returns `null` on failure or if
 * the target language is English (no-op).
 */
export async function translateFromEnglish(
  text: string,
  targetLanguage: string,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (targetLanguage.trim().toLowerCase() === 'english') return null;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 1024,
      system:
        `Translate the user's message from English into ${targetLanguage}. ` +
        'Respond with ONLY the translated text — no quotes, no notes, no markdown.',
      messages: [{ role: 'user', content: trimmed }],
    });

    const block = response.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') return null;
    return block.text.trim();
  } catch (error) {
    console.error('Translation (from English) failed:', error);
    return null;
  }
}

'use server';

import { getCachedSession } from '../auth/cached';
import { getAnthropicClient } from '../anthropic';
import { checkDailyAiLimit } from '../ai/daily-limit';
import { prisma } from '../prisma';
import { readProjectFile } from '../project-files';
import { getAccessibleProject } from '../projects/access';

const SUGGESTION_MODEL =
  process.env.BEDROCK_TRANSLATE_MODEL_ID?.trim() ||
  'eu.anthropic.claude-3-5-haiku-20241022-v1:0';

const MAX_SOURCE_CHARS = 24_000;

export type DesignSuggestion = {
  title: string;
  detail: string;
  /** Ready-to-send instruction for the website agent. */
  prompt: string;
};

function parseSuggestions(text: string): DesignSuggestion[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  const parsed: unknown = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => item as Partial<DesignSuggestion>)
    .filter(
      (s) =>
        typeof s.title === 'string' &&
        typeof s.detail === 'string' &&
        typeof s.prompt === 'string',
    )
    .slice(0, 5)
    .map((s) => ({
      title: s.title!.slice(0, 80),
      detail: s.detail!.slice(0, 300),
      prompt: s.prompt!.slice(0, 600),
    }));
}

/** AI design suggestions: clearer headline, more visible contact button, etc. */
export async function getDesignSuggestionsAction(
  projectId: string,
  artifactId: string,
) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    artifacts: { where: { id: artifactId }, select: { slug: true } },
  });
  const artifact = project?.artifacts[0];
  if (!artifact) return { error: 'Project or artifact not found.' };

  const limitError = await checkDailyAiLimit(userId, SUGGESTION_MODEL);
  if (limitError) return { error: limitError };

  const html = await readProjectFile(projectId, artifact.slug, 'index.html');
  if (!html) return { error: 'Build a page first to get suggestions.' };
  const css = (await readProjectFile(projectId, artifact.slug, 'styles.css')) ?? '';

  const source = `<!-- index.html -->\n${html}\n\n/* styles.css */\n${css}`.slice(
    0,
    MAX_SOURCE_CHARS,
  );

  const started = Date.now();
  try {
    const response = await getAnthropicClient().messages.create({
      model: SUGGESTION_MODEL,
      max_tokens: 1200,
      system:
        'You are a website design reviewer for small-business and portfolio sites. ' +
        'Given the page source, suggest 3 to 5 concrete improvements to design, content or layout ' +
        '(e.g. a clearer headline, a more visible contact button, better contrast, spacing, mobile layout). ' +
        'Respond with ONLY a JSON array, no markdown: ' +
        '[{"title": "<short title>", "detail": "<one or two sentences on why>", ' +
        '"prompt": "<instruction to an AI website editor that applies this change and leaves the rest untouched>"}]',
      messages: [{ role: 'user', content: source }],
    });

    const block = response.content.find((c) => c.type === 'text');
    const suggestions =
      block && block.type === 'text' ? parseSuggestions(block.text) : [];

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    await prisma.aiUsageEvent
      .create({
        data: {
          userId,
          projectId,
          provider: 'bedrock',
          model: SUGGESTION_MODEL,
          inputTokens,
          outputTokens,
          estimatedCostCents: Math.round(
            (inputTokens / 1_000_000) * 80 + (outputTokens / 1_000_000) * 400,
          ),
          latencyMs: Date.now() - started,
          status: 'SUCCESS',
        },
      })
      .catch(() => null);

    if (suggestions.length === 0) {
      return { error: 'No suggestions this time. Try again.' };
    }
    return { suggestions };
  } catch (error) {
    console.error('Design suggestions failed:', error);
    return { error: 'Could not generate suggestions right now.' };
  }
}

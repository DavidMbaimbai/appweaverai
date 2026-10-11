'use server';

import { checkDailyAiLimit } from '../ai/daily-limit';
import { getAnthropicClient } from '../anthropic';
import { getCachedSession } from '../auth/cached';
import {
  CONTENT_KINDS,
  isContentKind,
  isContentTone,
  parseContentVariants,
} from '../content-assistant';
import { prisma } from '../prisma';
import { readProjectFile } from '../project-files';
import { getAccessibleProject } from '../projects/access';

const CONTENT_MODEL =
  process.env.BEDROCK_TRANSLATE_MODEL_ID?.trim() ||
  'eu.anthropic.claude-3-5-haiku-20241022-v1:0';

const MAX_BRIEF_CHARS = 1_000;
const MAX_TEXT_CHARS = 3_000;

function pageContext(html: string | null) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

/** AI content assistant: writes or improves website text, returning up to 3 variants. */
export async function generateContentAction(input: {
  projectId: string;
  artifactId: string;
  kind: string;
  tone: string;
  brief: string;
  currentText?: string;
}) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized' };

  if (!isContentKind(input.kind) || !isContentTone(input.tone)) {
    return { error: 'Invalid request.' };
  }
  const brief = input.brief.trim().slice(0, MAX_BRIEF_CHARS);
  const currentText = (input.currentText ?? '').trim().slice(0, MAX_TEXT_CHARS);
  if (!brief && !currentText) {
    return { error: 'Describe what to write, or paste text to improve.' };
  }

  const project = await getAccessibleProject(input.projectId, userId, {
    id: true,
    name: true,
    description: true,
    artifacts: { where: { id: input.artifactId }, select: { slug: true } },
  });
  const artifact = project?.artifacts[0];
  if (!project || !artifact) return { error: 'Project not found.' };

  const limitError = await checkDailyAiLimit(userId, CONTENT_MODEL);
  if (limitError) return { error: limitError };

  const kind = CONTENT_KINDS.find((k) => k.id === input.kind)!;
  const context = pageContext(
    await readProjectFile(input.projectId, artifact.slug, 'index.html'),
  );

  const userMessage = [
    `Website: ${project.name}`,
    project.description ? `About the website: ${project.description.slice(0, 500)}` : '',
    context ? `Existing page text: ${context}` : '',
    `Write: ${kind.label}. ${kind.guidance}`,
    `Tone: ${input.tone}`,
    brief ? `Brief: ${brief}` : '',
    currentText ? `Improve this existing text:\n${currentText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const started = Date.now();
  try {
    const response = await getAnthropicClient().messages.create({
      model: CONTENT_MODEL,
      max_tokens: 1200,
      system:
        'You are a conversion-focused website copywriter. Write original, specific, natural copy ' +
        'that fits the business. Never invent facts such as prices, awards or statistics. ' +
        'Respond with ONLY a JSON array of exactly 3 distinct string options, no markdown. ' +
        'Use plain text only (no HTML); separate paragraphs with a blank line.',
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content.find((c) => c.type === 'text');
    const variants = block && block.type === 'text' ? parseContentVariants(block.text) : [];

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    await prisma.aiUsageEvent
      .create({
        data: {
          userId,
          projectId: input.projectId,
          provider: 'bedrock',
          model: CONTENT_MODEL,
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

    if (variants.length === 0) return { error: 'No text this time. Try again.' };
    return { variants };
  } catch (error) {
    console.error('Content assistant failed:', error);
    return { error: 'Could not generate text right now.' };
  }
}

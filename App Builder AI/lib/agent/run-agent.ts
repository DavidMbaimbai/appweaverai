import { access } from 'node:fs/promises';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropicClient } from '@/lib/anthropic';
import { applyFileEdit } from '@/lib/agent/apply-file-edit';
import { buildArtifactContextSnapshot } from '@/lib/agent/build-artifact-context';
import { getArtifactForProject } from '@/lib/agent/access';
import {
  ANTHROPIC_MAX_TOKENS,
  MAX_AGENT_CONTINUE_NUDGES,
  MAX_AGENT_TURNS,
  getAnthropicModel,
} from '@/lib/agent/constants';
import type { AgentLimits } from '@/lib/billing/entitlements';
import {
  buildAgentSystemPrompt,
  detectProjectStackFromPaths,
  getAgentTools,
  isPlanModeMessage,
  PLAN_MODE_ENABLED_MARKER,
} from '@/lib/agent/prompts';
import {
  buildAttachmentContextForAgent,
  isImageAttachmentPath,
  isTextAttachmentPath,
  readAttachmentBuffer,
  readAttachmentText,
} from '@/lib/project-attachments';
import { PROMPT_ATTACHMENTS_DIR } from '@/lib/prompt-attachments';
import {
  dedupeActionSteps,
  dedupeFileWrites,
  normalizeFileContent,
} from '@/lib/agent/step-utils';
import {
  extractCompleteBuildPartial,
  extractWriteFilePartial,
  languageFromPath,
} from '@/lib/agent/tool-input-parser';
import type {
  AgentFileWriteSnapshot,
  AgentRunResult,
  AgentStep,
  AgentStreamEvent,
} from '@/lib/agent/types';
import { bundleArtifact } from '@/lib/preview/bundle-artifact';
import {
  resolveProjectStack,
  type ProjectStack,
} from '@/lib/preview/detect-preview-mode';
import { formatBundleError } from '@/lib/preview/format-bundle-error';
import { artifactWorkspaceDir } from '@/lib/project-files';
import {
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
} from '@/lib/project-files';
import { prisma } from '@/lib/prisma';

const MAX_AGENT_MESSAGES = 50;
const BUILD_NOT_READY_PREFIX = 'BUILD_NOT_READY:';

type ValidateArtifactPreviewResult =
  | { ok: true; stack: ProjectStack }
  | { ok: false; stack: ProjectStack; errors: string[] };

async function validateArtifactPreview(
  projectId: string,
  artifactSlug: string,
): Promise<ValidateArtifactPreviewResult> {
  const { stack, relativePaths } = await resolveProjectStack(
    projectId,
    artifactSlug,
  );

  if (stack === 'static') {
    const indexPath = path.join(
      artifactWorkspaceDir(projectId, artifactSlug),
      'index.html',
    );
    try {
      await access(indexPath);
      return { ok: true, stack };
    } catch {
      return {
        ok: false,
        stack,
        errors: [
          'Missing index.html — static previews require an index.html entry file.',
        ],
      };
    }
  }

  try {
    await bundleArtifact({ projectId, artifactSlug, relativePaths, stack });
    return { ok: true, stack };
  } catch (error) {
    return {
      ok: false,
      stack,
      errors: [formatBundleError(error)],
    };
  }
}

type RunAgentLoopOptions = {
  conversationId: string;
  projectId: string;
  artifactId: string;
  limits?: AgentLimits;
  onEvent?: (event: AgentStreamEvent) => void;
};

type ToolContext = {
  conversationId: string;
  projectId: string;
  artifactId: string;
  artifactSlug: string;
  artifactName: string;
  planMode: boolean;
  existingPaths: Set<string>;
  readPaths: Set<string>;
  writtenPaths: Set<string>;
  readCache: Map<string, string>;
  steps: AgentStep[];
  fileWrites: AgentFileWriteSnapshot[];
  previewVersion: number;
  buildValid: boolean;
  planQuestion?: { question: string; options: string[] };
  planCompleted?: boolean;
  lastFileStreamEmit: Map<string, number>;
  onEvent?: (event: AgentStreamEvent) => void;
};

type StreamingToolBlock = {
  id: string;
  name: string;
  json: string;
};

function emitAction(
  ctx: ToolContext,
  label: string,
  path?: string,
  status: 'running' | 'done' = 'done',
) {
  const step: AgentStep = { type: 'action', label, path, status };
  ctx.steps.push(step);
  ctx.onEvent?.({ type: 'action', label, path, status });
  ctx.onEvent?.({
    type: 'status',
    phase: 'working',
    actionCount: ctx.steps.length,
  });
}

function upsertFileWrite(
  ctx: ToolContext,
  relativePath: string,
  content: string,
  status: 'streaming' | 'done',
) {
  const dbPath = `${ctx.artifactSlug}/${relativePath}`;
  const language = languageFromPath(relativePath);
  const existingIndex = ctx.fileWrites.findIndex(
    (file) => file.path === dbPath,
  );

  const snapshot: AgentFileWriteSnapshot = {
    path: dbPath,
    content: normalizeFileContent(content),
    language,
    status,
  };

  if (existingIndex >= 0) {
    ctx.fileWrites[existingIndex] = snapshot;
  } else {
    ctx.fileWrites.push(snapshot);
  }

  if (status === 'streaming') {
    const now = Date.now();
    const lastEmit = ctx.lastFileStreamEmit.get(dbPath) ?? 0;
    const isNewFile = existingIndex < 0;
    if (!isNewFile && now - lastEmit < 200) {
      return;
    }
    ctx.lastFileStreamEmit.set(dbPath, now);
  } else {
    ctx.lastFileStreamEmit.delete(dbPath);
  }

  ctx.onEvent?.({
    type: 'file_write',
    path: dbPath,
    content,
    language,
    status,
  });
}

function handleStreamingToolDelta(ctx: ToolContext, block: StreamingToolBlock) {
  if (block.name === 'write_file') {
    const parsed = extractWriteFilePartial(block.json);
    if (parsed.path) {
      upsertFileWrite(ctx, parsed.path, parsed.content ?? '', 'streaming');
    }
    return;
  }

  if (block.name === 'complete_build') {
    const parsed = extractCompleteBuildPartial(block.json);
    if (parsed.summary) {
      ctx.onEvent?.({ type: 'text_delta', content: parsed.summary });
    }
  }
}

async function exitPlanMode(conversationId: string, plan: string) {
  await prisma.agentMessage.updateMany({
    where: {
      conversationId,
      role: 'SYSTEM',
      content: { contains: PLAN_MODE_ENABLED_MARKER },
    },
    data: {
      content: `Plan mode completed.\n\nApproved plan:\n${plan}`,
    },
  });
}

function normalizePlanOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((option) => String(option ?? '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: string; stopForQuestion?: boolean }> {
  switch (name) {
    case 'ask_plan_question': {
      const question = String(input.question ?? '').trim();
      const options = normalizePlanOptions(input.options);

      if (!question) {
        return { result: 'Question text is required.' };
      }
      if (options.length < 2) {
        return { result: 'Provide 3–4 options for the user to pick from.' };
      }

      ctx.planQuestion = { question, options };
      ctx.onEvent?.({ type: 'plan_question', question, options });
      emitAction(ctx, 'Asked planning question');
      return {
        result: 'Question sent to user. Wait for their choice.',
        stopForQuestion: true,
      };
    }

    case 'complete_plan': {
      const plan = String(input.plan ?? '').trim();
      if (!plan) {
        return { result: 'Plan content is required.' };
      }

      await exitPlanMode(ctx.conversationId, plan);
      ctx.planMode = false;
      ctx.planCompleted = true;
      ctx.onEvent?.({ type: 'plan_completed' });
      emitAction(ctx, 'Finalized plan');

      return {
        result: `Plan approved. Begin building immediately according to this plan:\n\n${plan}`,
      };
    }

    case 'list_files': {
      const files = await listProjectFiles(ctx.projectId, ctx.artifactSlug);
      emitAction(ctx, 'Listed project files');
      if (files.length === 0) {
        return { result: 'No files yet.' };
      }
      return {
        result: files
          .map((file) => file.path.replace(`${ctx.artifactSlug}/`, ''))
          .join('\n'),
      };
    }

    case 'read_file': {
      const filePath = String(input.path ?? '');
      emitAction(ctx, `Read ${filePath}`, `${ctx.artifactSlug}/${filePath}`);

      if (isImageAttachmentPath(filePath)) {
        ctx.readPaths.add(filePath);
        return {
          result: `Image attachment at \`${filePath}\`. It is included in the conversation when vision is available. Reference it in HTML with src="${filePath}".`,
        };
      }

      if (filePath.startsWith(`${PROMPT_ATTACHMENTS_DIR}/`)) {
        if (isTextAttachmentPath(filePath)) {
          try {
            const { text } = await readAttachmentText(
              ctx.projectId,
              ctx.artifactSlug,
              filePath,
            );
            ctx.readPaths.add(filePath);
            return { result: text };
          } catch {
            return { result: `File not found: ${filePath}` };
          }
        }

        try {
          const { mimeType, sizeBytes } = await readAttachmentBuffer(
            ctx.projectId,
            ctx.artifactSlug,
            filePath,
          );
          ctx.readPaths.add(filePath);
          return {
            result: `Binary attachment \`${filePath}\` (${mimeType}, ${sizeBytes} bytes). Use the filename and user prompt for context.`,
          };
        } catch {
          return { result: `File not found: ${filePath}` };
        }
      }

      const content = await readProjectFile(
        ctx.projectId,
        ctx.artifactSlug,
        filePath,
      );
      if (content == null) {
        return { result: `File not found: ${filePath}` };
      }
      ctx.readPaths.add(filePath);
      ctx.readCache.set(filePath, content);
      return { result: content };
    }

    case 'edit_file': {
      if (ctx.planMode) {
        return {
          result:
            'Plan mode is still active. Call complete_plan first, then build.',
        };
      }

      const filePath = String(input.path ?? '');
      const oldString = String(input.old_string ?? '');
      const newString = String(input.new_string ?? '');
      const replaceAll = input.replace_all === true;

      const pathExists = ctx.existingPaths.has(filePath);

      if (
        pathExists &&
        !ctx.readPaths.has(filePath) &&
        !ctx.writtenPaths.has(filePath)
      ) {
        return {
          result: `You must read_file "${filePath}" before editing an existing file.`,
        };
      }

      if (!pathExists) {
        return {
          result: `File not found: ${filePath}. Use write_file to create new files.`,
        };
      }

      const currentContent =
        ctx.readCache.get(filePath) ??
        (await readProjectFile(ctx.projectId, ctx.artifactSlug, filePath));

      if (currentContent == null) {
        return { result: `File not found: ${filePath}` };
      }

      const editResult = applyFileEdit(
        currentContent,
        oldString,
        newString,
        replaceAll,
      );
      if (!editResult.ok) {
        return { result: editResult.error };
      }

      await writeProjectFile({
        projectId: ctx.projectId,
        artifactSlug: ctx.artifactSlug,
        artifactId: ctx.artifactId,
        relativePath: filePath,
        content: editResult.content,
      });

      ctx.readCache.set(filePath, editResult.content);
      ctx.writtenPaths.add(filePath);
      ctx.readPaths.add(filePath);
      ctx.previewVersion += 1;
      upsertFileWrite(ctx, filePath, editResult.content, 'done');
      emitAction(
        ctx,
        `Edited ${filePath} (${editResult.replacements} replacement${editResult.replacements === 1 ? '' : 's'})`,
        `${ctx.artifactSlug}/${filePath}`,
      );

      return {
        result: `Applied edit to ${filePath} (${editResult.replacements} replacement${editResult.replacements === 1 ? '' : 's'}, ${editResult.content.length} bytes).`,
      };
    }

    case 'write_file': {
      if (ctx.planMode) {
        return {
          result:
            'Plan mode is still active. Call complete_plan first, then build.',
        };
      }

      const filePath = String(input.path ?? '');
      const content = String(input.content ?? '');

      const pathExists = ctx.existingPaths.has(filePath);

      if (
        pathExists &&
        !ctx.readPaths.has(filePath) &&
        !ctx.writtenPaths.has(filePath)
      ) {
        return {
          result: `You must read_file "${filePath}" before overwriting an existing file. Prefer edit_file for targeted changes.`,
        };
      }

      const previousContent = pathExists
        ? ctx.readCache.get(filePath)
        : undefined;
      if (
        pathExists &&
        previousContent &&
        content.length < previousContent.length * 0.55
      ) {
        return {
          result: `Refusing full rewrite: new content (${content.length} bytes) is much shorter than the read file (${previousContent.length} bytes) and may drop existing functionality. Use edit_file for targeted changes, or include ALL original code plus your edits in write_file.`,
        };
      }

      await writeProjectFile({
        projectId: ctx.projectId,
        artifactSlug: ctx.artifactSlug,
        artifactId: ctx.artifactId,
        relativePath: filePath,
        content,
      });

      ctx.writtenPaths.add(filePath);
      ctx.existingPaths.add(filePath);
      ctx.readCache.set(filePath, content);
      ctx.previewVersion += 1;
      upsertFileWrite(ctx, filePath, content, 'done');
      return { result: `Saved ${filePath} (${content.length} bytes).` };
    }

    case 'complete_build': {
      if (ctx.planMode) {
        return {
          result:
            'Plan mode is still active. Call complete_plan first, then build.',
        };
      }

      const summary = String(input.summary ?? '').trim();
      emitAction(ctx, 'Validating preview');

      const validation = await validateArtifactPreview(
        ctx.projectId,
        ctx.artifactSlug,
      );
      if (!validation.ok) {
        ctx.buildValid = false;
        return {
          result: `${BUILD_NOT_READY_PREFIX} Preview validation failed (${validation.stack}). Fix these errors, then call complete_build again:\n\n${validation.errors.join('\n\n')}`,
        };
      }

      ctx.buildValid = true;
      emitAction(ctx, 'Completed build');
      return { result: summary || 'Build complete.' };
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

async function streamAssistantTurn(
  client: Anthropic,
  systemPrompt: string,
  chatMessages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  ctx: ToolContext,
  limits: AgentLimits,
) {
  const stream = client.messages.stream({
    model: limits.model,
    max_tokens: limits.maxTokens,
    system: systemPrompt,
    tools,
    messages: chatMessages,
  });

  const toolBlocks = new Map<number, StreamingToolBlock>();
  let textSnapshot = '';

  stream.on('streamEvent', (event) => {
    if (
      event.type === 'content_block_start' &&
      event.content_block.type === 'tool_use'
    ) {
      toolBlocks.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        json: '',
      });
    }

    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'input_json_delta') {
        const block = toolBlocks.get(event.index);
        if (!block) return;
        block.json += event.delta.partial_json;
        handleStreamingToolDelta(ctx, block);
      }

      if (event.delta.type === 'text_delta') {
        textSnapshot += event.delta.text;
        ctx.onEvent?.({ type: 'text_delta', content: textSnapshot });
      }
    }
  });

  return stream.finalMessage();
}

function buildUserMessageParam(
  text: string,
  images: Array<{
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  }>,
): Anthropic.MessageParam {
  if (images.length === 0) {
    return { role: 'user', content: text };
  }

  return {
    role: 'user',
    content: [
      ...images.map((image) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mediaType,
          data: image.data,
        },
      })),
      { type: 'text' as const, text },
    ],
  };
}

export async function runAgentLoop({
  conversationId,
  projectId,
  artifactId,
  limits,
  onEvent,
}: RunAgentLoopOptions): Promise<AgentRunResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key is not configured.');
  }

  const agentLimits: AgentLimits = limits ?? {
    maxTurns: MAX_AGENT_TURNS,
    maxTokens: ANTHROPIC_MAX_TOKENS,
    model: getAnthropicModel(),
  };

  const artifact = await getArtifactForProject(projectId, artifactId);
  if (!artifact) {
    throw new Error('Artifact not found.');
  }

  if (
    artifact.type !== 'WEB_APP' &&
    artifact.type !== 'MOBILE_APP' &&
    artifact.type !== 'DESIGN'
  ) {
    throw new Error(
      'This artifact type does not support file-based builds yet.',
    );
  }

  const [project, rawMessages, artifactFiles] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, description: true },
    }),
    prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_AGENT_MESSAGES,
      select: { role: true, content: true },
    }),
    listProjectFiles(projectId, artifact.slug),
  ]);

  if (!project) {
    throw new Error('Project not found.');
  }

  const messages = rawMessages.slice().reverse();

  const planMode = messages.some(
    (message) =>
      message.role === 'SYSTEM' && isPlanModeMessage(message.content),
  );

  const relativePaths = artifactFiles.map((file) =>
    file.path.replace(`${artifact.slug}/`, ''),
  );

  const buildablePaths = relativePaths.filter(
    (path) => !path.startsWith(`${PROMPT_ATTACHMENTS_DIR}/`),
  );
  const hasExistingFiles = buildablePaths.length > 0;

  const indexHtml = relativePaths.includes('index.html')
    ? await readProjectFile(projectId, artifact.slug, 'index.html')
    : null;

  const artifactSnapshot = await buildArtifactContextSnapshot({
    projectId,
    artifactSlug: artifact.slug,
    artifactFiles: artifactFiles.map((file) => ({
      path: file.path,
      updatedAt: file.updatedAt,
    })),
  });

  const attachmentContext = await buildAttachmentContextForAgent(
    projectId,
    artifact.slug,
  );

  const promptContext = {
    projectName: project.name,
    projectDescription: project.description,
    artifactName: artifact.name,
    artifactType: artifact.type,
    artifactSnapshot,
    projectStack: detectProjectStackFromPaths(relativePaths, indexHtml),
  };

  let systemPrompt = buildAgentSystemPrompt({
    ...promptContext,
    planMode,
    attachmentContext: attachmentContext.summary || undefined,
    hasExistingFiles,
  });

  const chatMessages: Anthropic.MessageParam[] = [];
  let injectedVision = false;

  for (const message of messages) {
    if (message.role === 'SYSTEM') continue;

    if (
      message.role === 'USER' &&
      !injectedVision &&
      attachmentContext.images.length > 0
    ) {
      chatMessages.push(
        buildUserMessageParam(message.content, attachmentContext.images),
      );
      injectedVision = true;
      continue;
    }

    chatMessages.push({
      role: message.role === 'USER' ? 'user' : 'assistant',
      content: message.content,
    });
  }

  const existingPaths = new Set(relativePaths);

  const ctx: ToolContext = {
    conversationId,
    projectId,
    artifactId,
    artifactSlug: artifact.slug,
    artifactName: artifact.name,
    planMode,
    existingPaths,
    readPaths: new Set(),
    writtenPaths: new Set(),
    readCache: new Map(),
    steps: [],
    fileWrites: [],
    previewVersion: 0,
    buildValid: false,
    lastFileStreamEmit: new Map(),
    onEvent,
  };

  onEvent?.({ type: 'status', phase: 'working', actionCount: 0 });

  const client = getAnthropicClient();
  let summary = '';
  let turn = 0;
  let continueNudges = 0;
  let hitTurnLimit = false;

  while (turn < agentLimits.maxTurns) {
    turn += 1;

    const response = await streamAssistantTurn(
      client,
      systemPrompt,
      chatMessages,
      getAgentTools(ctx.planMode),
      ctx,
      agentLimits,
    );
    chatMessages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      const textBlock = response.content.find((block) => block.type === 'text');
      const text = textBlock?.type === 'text' ? textBlock.text.trim() : '';

      const buildInProgress =
        !ctx.buildValid &&
        !ctx.planQuestion &&
        (ctx.writtenPaths.size > 0 ||
          ctx.fileWrites.length > 0 ||
          ctx.planCompleted);

      if (
        buildInProgress &&
        continueNudges < MAX_AGENT_CONTINUE_NUDGES &&
        turn < agentLimits.maxTurns
      ) {
        continueNudges += 1;
        if (text) {
          ctx.onEvent?.({ type: 'text_delta', content: text });
        }
        chatMessages.push({
          role: 'user',
          content:
            'The build is not finished yet. Continue implementing the remaining files, then call complete_build when the preview is ready.',
        });
        continue;
      }

      summary = text || 'Done.';
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let stopForQuestion = false;

    for (const toolUse of toolUses) {
      const input = (toolUse.input ?? {}) as Record<string, unknown>;
      const { result, stopForQuestion: shouldStop } = await executeTool(
        toolUse.name,
        input,
        ctx,
      );

      if (toolUse.name === 'complete_plan') {
        systemPrompt = buildAgentSystemPrompt({
          ...promptContext,
          planMode: false,
          attachmentContext: attachmentContext.summary || undefined,
          hasExistingFiles,
        });
      }

      if (toolUse.name === 'ask_plan_question' && shouldStop) {
        summary = ctx.planQuestion?.question ?? result;
        stopForQuestion = true;
      }

      if (
        toolUse.name === 'complete_build' &&
        !result.startsWith(BUILD_NOT_READY_PREFIX)
      ) {
        summary = result;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    if (stopForQuestion) {
      break;
    }

    chatMessages.push({ role: 'user', content: toolResults });

    if (summary) {
      break;
    }

    if (response.stop_reason !== 'tool_use' && !summary) {
      const textBlock = response.content.find((block) => block.type === 'text');
      if (textBlock?.type === 'text' && textBlock.text.trim()) {
        const text = textBlock.text.trim();
        const buildInProgress =
          !ctx.buildValid &&
          !ctx.planQuestion &&
          (ctx.writtenPaths.size > 0 ||
            ctx.fileWrites.length > 0 ||
            ctx.planCompleted);

        if (
          buildInProgress &&
          continueNudges < MAX_AGENT_CONTINUE_NUDGES &&
          turn < agentLimits.maxTurns
        ) {
          continueNudges += 1;
          ctx.onEvent?.({ type: 'text_delta', content: text });
          chatMessages.push({
            role: 'user',
            content:
              'Keep going — finish the remaining work and call complete_build when done.',
          });
          continue;
        }

        summary = text;
        break;
      }
    }
  }

  hitTurnLimit =
    turn >= agentLimits.maxTurns && !ctx.buildValid && !ctx.planQuestion;

  if (!summary && ctx.planQuestion) {
    summary = ctx.planQuestion.question;
  }

  if (!summary) {
    summary = ctx.planCompleted
      ? 'Plan finalized — building your project now.'
      : hitTurnLimit
        ? "I made progress but ran out of steps before finishing. Reply **continue** and I'll pick up where I left off."
        : "I've updated your project. Check the preview to see the result.";
  } else if (hitTurnLimit && !ctx.buildValid) {
    summary = `${summary}\n\n—\nStill in progress. Reply **continue** to finish the build.`;
  }

  onEvent?.({ type: 'text', content: summary });

  const finalSteps = dedupeActionSteps(
    ctx.steps.map((step) =>
      step.type === 'action' ? { ...step, status: 'done' as const } : step,
    ),
  );

  const finalFileWrites = dedupeFileWrites(
    ctx.fileWrites.map((file) => ({
      ...file,
      status: 'done' as const,
    })),
  );

  return {
    summary,
    steps: finalSteps,
    fileWrites: finalFileWrites,
    previewVersion: ctx.previewVersion,
    presentedArtifactId: ctx.buildValid ? artifactId : undefined,
    buildValid: ctx.buildValid,
    planQuestion: ctx.planQuestion,
    planCompleted: ctx.planCompleted,
  };
}

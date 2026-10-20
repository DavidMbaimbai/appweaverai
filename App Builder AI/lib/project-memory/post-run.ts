import { getAnthropicClient } from '@/lib/anthropic';
import { getAgentModelOption } from '@/lib/agent/model-catalog';
import { withCredits } from '@/lib/credits/with-credits';
import { prisma } from '@/lib/prisma';

import { applyLlmPurposes, refreshCodeMap, type FileSource } from './code-map';
import { buildExtractionCall, parseExtraction } from './extraction';
import { createMemory, listActiveMemories } from './store';
import { LIMITS } from './types';

export type ModelCaller = (call: { system: string; user: string; maxTokens: number }) => Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}>;

export const defaultModelCaller: ModelCaller = async ({ system, user, maxTokens }) => {
  const response = await getAnthropicClient().messages.create({
    model: getAgentModelOption('claude-haiku').bedrockModelId,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content.find((c) => c.type === 'text');
  return {
    text: block && block.type === 'text' ? block.text : '',
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
};

const PROTECT_WORDING = /\b(protect(ed)?|lock(ed)?|freeze|frozen)\b|(don'?t|do not|must not|never)\s+(touch|change|break|modify|edit)/i;

export type PostRunResult = {
  codeMap: { changed: number; removed: number; unchanged: number };
  proposed: number;
  created: number;
  superseded: number;
  skipped: number;
  rejectedForSecrets: number;
  llm: 'used' | 'skipped-no-change' | 'skipped-credits' | 'failed' | 'skipped-disabled';
};

/**
 * Bounded post-run step: refresh the code map by hash diff, then make at most one cheap model call
 * (credit-metered, once per run) to propose memory updates and file purposes. Never throws.
 */
export async function runMemoryPostRun(args: {
  projectId: string;
  userId: string | null;
  artifactSlug: string;
  conversationId?: string | null;
  messageId?: string | null;
  checkpointId?: string | null;
  userRequest: string;
  runSummary: string;
  callModel?: ModelCaller;
  source?: FileSource;
}): Promise<PostRunResult> {
  const result: PostRunResult = {
    codeMap: { changed: 0, removed: 0, unchanged: 0 },
    proposed: 0,
    created: 0,
    superseded: 0,
    skipped: 0,
    rejectedForSecrets: 0,
    llm: 'skipped-no-change',
  };
  try {
    const refresh = await refreshCodeMap(args.projectId, args.artifactSlug, args.source);
    result.codeMap = { changed: refresh.changed.length, removed: refresh.removed.length, unchanged: refresh.unchanged };
    if (refresh.changed.length === 0 && refresh.removed.length === 0) return result;

    if (process.env.PROJECT_MEMORY_LLM === 'false') {
      result.llm = 'skipped-disabled';
      return result;
    }
    const callModel = args.callModel ?? defaultModelCaller;
    const existing = await listActiveMemories(args.projectId);
    let userRequest = args.userRequest;
    if (!userRequest && args.conversationId) {
      const last = await prisma.agentMessage.findFirst({
        where: { conversationId: args.conversationId, role: 'USER', conversation: { projectId: args.projectId } },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      userRequest = last?.content ?? '';
    }
    const call = buildExtractionCall({
      userRequest,
      runSummary: args.runSummary,
      changed: refresh.changed.slice(0, LIMITS.maxLlmFilesPerRun * 2),
      exportDeltas: refresh.exportDeltas,
      removed: refresh.removed,
      existingTitles: existing.map((e) => e.title),
    });

    const run = async () => callModel({ system: call.system, user: call.messages[0].content, maxTokens: 1200 });
    let output: Awaited<ReturnType<ModelCaller>> | null = null;
    if (args.userId) {
      const outcome = await withCredits(args.userId, 'memory_update', run, {
        refType: 'Project',
        refId: args.projectId,
        idempotencyKey: args.messageId ? `memory_update:${args.messageId}` : undefined,
      });
      if (!outcome.ok) {
        result.llm = 'skipped-credits';
        return result;
      }
      output = outcome.value;
    } else {
      output = await run();
    }
    result.llm = 'used';
    void prisma.aiUsageEvent
      .create({
        data: {
          userId: args.userId ?? undefined,
          projectId: args.projectId,
          provider: 'bedrock',
          model: 'project-memory',
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          estimatedCostCents: 0,
          latencyMs: 0,
          status: 'SUCCESS',
        },
      })
      .catch(() => null);

    const parsed = parseExtraction(output.text);
    const knownPaths = new Set(refresh.changed.map((c) => c.path));
    await applyLlmPurposes(
      args.projectId,
      args.artifactSlug,
      parsed.purposes.filter((p) => knownPaths.has(p.path)),
    );

    const allowProtected = PROTECT_WORDING.test(userRequest);
    result.proposed = parsed.memories.length;
    for (const memory of parsed.memories) {
      const write = await createMemory({
        projectId: args.projectId,
        source: 'AGENT',
        createdById: args.userId,
        input: { ...memory, featureState: memory.featureState === 'PROTECTED' && !allowProtected ? 'COMPLETED' : memory.featureState },
        evidence: {
          files: (memory.files ?? []).slice(0, 10),
          ...(args.checkpointId ? { checkpointId: args.checkpointId } : {}),
          ...(args.messageId ? { messageId: args.messageId } : {}),
        },
      });
      if (write.ok) {
        result.created += 1;
        result.superseded += write.supersededIds.length;
      } else if (write.error.startsWith('Rejected')) {
        result.rejectedForSecrets += 1;
      } else {
        result.skipped += 1;
      }
    }
  } catch (error) {
    console.error('[project-memory] post-run update failed:', error);
    result.llm = 'failed';
  }
  return result;
}

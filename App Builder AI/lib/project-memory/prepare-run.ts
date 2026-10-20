import { refreshCodeMap } from './code-map';
import { buildProjectBrief } from './brief';
import { findUnacknowledged, formatUnacknowledgedNote, RegressionGuard } from './guard';
import { listActiveMemories, listCodeMap, markUnacknowledged, recordInjection } from './store';

export type PreparedBrief = {
  text: string;
  guard: RegressionGuard;
  injectionId: string | null;
};

/** Assembles the brief for one agent run. Memory is additive context: any failure yields an empty brief. */
export async function prepareProjectBrief(args: {
  projectId: string;
  artifactSlug: string;
  conversationId?: string | null;
  request: string;
}): Promise<PreparedBrief> {
  const empty: PreparedBrief = { text: '', guard: new RegressionGuard([]), injectionId: null };
  try {
    let codeMap = await listCodeMap(args.projectId, args.artifactSlug);
    if (codeMap.length === 0) {
      await refreshCodeMap(args.projectId, args.artifactSlug).catch(() => null);
      codeMap = await listCodeMap(args.projectId, args.artifactSlug);
    }
    const memories = await listActiveMemories(args.projectId);
    const brief = buildProjectBrief({ memories, codeMap, request: args.request });
    const guard = new RegressionGuard(brief.protectedFeatures);
    if (!brief.text) return { ...empty, guard };
    const injectionId = await recordInjection({
      projectId: args.projectId,
      conversationId: args.conversationId,
      request: args.request,
      brief: brief.text,
      memoryIds: brief.memoryIds,
      tokenEstimate: brief.tokenEstimate,
      protectedFiles: brief.protectedFiles,
    });
    return { text: brief.text, guard, injectionId };
  } catch (error) {
    console.error('[project-memory] brief assembly failed:', error);
    return empty;
  }
}

/** Post-run regression check: returns a note to append to the run summary when protected files were edited without acknowledgement. */
export async function checkRunAcknowledgement(args: {
  projectId: string;
  guard: RegressionGuard;
  injectionId: string | null;
  summary: string;
}): Promise<string> {
  const missing = findUnacknowledged(args.summary, args.guard.touchedFeatures());
  if (missing.length === 0) return '';
  if (args.injectionId) {
    await markUnacknowledged(args.projectId, args.injectionId, missing.map((m) => m.title)).catch(() => null);
  }
  return formatUnacknowledgedNote(missing);
}

import { DEFAULT_MARKETING_PRICES } from '@/lib/marketing-credits/pricing';

import type { PipelineView, RunView } from '@/components/app/content-pipeline/content-pipeline-panel';

import { estimateDailyCredits, normalizeConfig } from './logic';
import { DEFAULT_CONFIG } from './types';
import { getPipeline, listRuns } from './service';
import type { AgentScope } from '@/lib/agents/types';

export async function loadPipelineView(scope: AgentScope) {
  const pipeline = await getPipeline(scope);
  const runs = pipeline ? await listRuns(pipeline.id, 14) : [];
  const base = pipeline
    ? normalizeConfig({ ...pipeline, objective: pipeline.objective ?? '' }, scope.type)
    : null;
  const config = base && base.ok ? base.value : DEFAULT_CONFIG;
  const initial: PipelineView = {
    ...config,
    paused: pipeline?.paused ?? false,
  } as PipelineView;
  const runViews: RunView[] = runs.map((r) => ({
    id: r.id,
    runDate: r.runDate,
    status: r.status,
    trigger: r.trigger,
    steps: (r.steps ?? {}) as RunView['steps'],
    errors: Array.isArray(r.errors) ? (r.errors as unknown[]).map(String) : [],
  }));
  const estimate = scope.type === 'PROJECT' ? estimateDailyCredits(config, DEFAULT_MARKETING_PRICES as never) : null;
  return { exists: Boolean(pipeline), initial, runs: runViews, estimate };
}

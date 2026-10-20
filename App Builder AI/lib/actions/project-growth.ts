'use server';

import { revalidatePath } from 'next/cache';

import { getCachedSession } from '../auth/cached';
import { withMarketingCredits } from '../marketing-credits/run';
import { approveExperiment, measureExperiment, proposeExperiments, rejectExperiment, startExperiment } from '../growth/service';

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function requireUser() {
  const session = await getCachedSession();
  return session?.user?.id ?? null;
}

async function run(fn: (userId: string) => Promise<Result | { ok: true; created: number }>): Promise<Result> {
  const userId = await requireUser();
  if (!userId) return { ok: false, error: 'Unauthorized' };
  const res = await fn(userId);
  revalidatePath('/app/projects');
  if (!res.ok) return res;
  return { ok: true, message: 'message' in res ? res.message : 'created' in res ? `${res.created} experiment(s) proposed.` : undefined };
}

export async function proposeExperimentsAction(projectId: string) {
  return run(async (u) => {
    const paid = await withMarketingCredits(
      {
        userId: u,
        projectId: String(projectId),
        operation: 'growth_draft',
        refType: 'Project',
        refId: String(projectId),
        isFailure: (r: Awaited<ReturnType<typeof proposeExperiments>>) => !r.ok,
      },
      () => proposeExperiments(u, String(projectId)),
    );
    return paid.ok ? paid.value : { ok: false as const, error: paid.error };
  });
}
export async function approveExperimentAction(id: string) {
  return run((u) => approveExperiment(u, String(id)));
}
export async function rejectExperimentAction(id: string) {
  return run((u) => rejectExperiment(u, String(id)));
}
export async function startExperimentAction(id: string) {
  return run((u) => startExperiment(u, String(id)));
}
export async function measureExperimentAction(id: string) {
  return run((u) => measureExperiment(u, String(id)));
}

import { prisma } from '@/lib/prisma';

import { withMarketingCredits, type MarketingOutcome, type WithMarketingOptions } from './run';
import { recordInternalOperation } from './internal-cost';

/** The billing owner of a project (workspace owner); used by server-side jobs that have no acting user. */
export async function projectBillingOwner(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { createdById: true, workspace: { select: { ownerId: true } } },
  });
  return project ? (project.workspace?.ownerId ?? project.createdById) : null;
}

type ScopeOptions<T> = Omit<WithMarketingOptions<T>, 'userId' | 'projectId'> & {
  scope: { type: 'PLATFORM' } | { type: 'PROJECT'; projectId: string };
};

/**
 * For code that only knows an agent scope (inbox, cron jobs). Project scope bills the project's owner as a customer;
 * the platform scope is AppWeaver's own and only logs an internal cost. Scope comes from stored data, never a client field.
 */
export async function withScopeMarketing<T>(options: ScopeOptions<T>, fn: () => Promise<T>): Promise<MarketingOutcome<T>> {
  const { scope, ...rest } = options;
  if (scope.type === 'PLATFORM') {
    const value = await fn();
    if (!rest.isFailure?.(value)) {
      await recordInternalOperation(rest.operation, {
        refType: rest.refType,
        refId: rest.refId,
        units: rest.params?.units ?? rest.params?.seconds,
      });
    }
    return { ok: true, value, charged: 0, billing: 'APPWEAVER_INTERNAL' };
  }
  const owner = await projectBillingOwner(scope.projectId);
  if (!owner) return { ok: false, reason: 'forbidden', error: 'Project not found.', insufficient: false };
  return withMarketingCredits({ ...rest, userId: owner, projectId: scope.projectId }, fn);
}

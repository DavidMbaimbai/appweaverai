import { notFound } from 'next/navigation';

import { GrowthDashboard } from '@/components/app/growth/growth-dashboard';
import { getCachedSession } from '@/lib/auth/cached';
import type { ProposedAction } from '@/lib/growth/experiments';
import { collectGrowth, GROWTH_CAVEAT } from '@/lib/growth/metrics';
import { periodFor } from '@/lib/growth/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

type Props = {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams?: Promise<{ days?: string }>;
};

export default async function ProjectGrowthPage({ params, searchParams }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const requested = Number((await searchParams)?.days);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const { from, to } = periodFor(days);
  const [snapshot, experiments] = await Promise.all([
    collectGrowth(project.id, from, to),
    prisma.growthExperiment.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  return (
    <GrowthDashboard
      projectId={project.id}
      projectName={project.name}
      leadsHref={`/app/projects/${workspaceSlug}/${projectSlug}/leads`}
      days={days}
      caveat={GROWTH_CAVEAT}
      snapshot={snapshot}
      experiments={experiments.map((e) => {
        const action = e.proposedAction as unknown as ProposedAction;
        const before = e.metricBefore as { value: number | null } | null;
        const after = e.metricAfter as { value: number | null } | null;
        return {
          id: e.id,
          hypothesis: e.hypothesis,
          bottleneck: e.bottleneck,
          action,
          estimatedCostCents: e.estimatedCostCents,
          status: e.status,
          before: before ? { value: before.value } : null,
          after: after ? { value: after.value } : null,
          resultNote: e.resultNote,
          windowDays: e.windowDays,
          startedAt: e.startedAt?.toISOString() ?? null,
          execution: (e.executionResult as Record<string, string> | null) ?? null,
        };
      })}
    />
  );
}

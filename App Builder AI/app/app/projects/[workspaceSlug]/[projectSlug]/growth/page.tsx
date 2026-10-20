import { notFound } from 'next/navigation';

import { GrowthDashboard } from '@/components/app/growth/growth-dashboard';
import { ProjectInsights } from '@/components/growth-bi/project-insights';
import { collectProject } from '@/lib/growth-bi/project';
import { listRecommendations } from '@/lib/growth-bi/service';
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
  const [snapshot, experiments, insights, insightAlerts, insightRecs] = await Promise.all([
    collectGrowth(project.id, from, to),
    prisma.growthExperiment.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    collectProject(project.id, from, to),
    prisma.growthAlert.findMany({ where: { scopeType: 'PROJECT', scopeId: project.id }, orderBy: { day: 'desc' }, take: 5, select: { id: true, message: true } }),
    listRecommendations('PROJECT', project.id),
  ]);

  return (
    <>
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
    <ProjectInsights projectId={project.id} days={days} snapshot={insights} alerts={insightAlerts} recommendations={insightRecs} />
    </>
  );
}
